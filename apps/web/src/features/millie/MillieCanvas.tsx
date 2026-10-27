"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { MillieController } from "./lib/millie.js";
import styles from "./MillieCanvas.module.css";

const VRM_URL = "/millie/millie_chibi_v2_2_web.vrm";

export type MillieHandle = {
  say: (text: string) => void;
  react: (name: string, hold?: number) => void;
  play: (name: string) => void;
  pointAt: (el: Element | null) => void;
  stopPointing: () => void;
};

type Props = { active: boolean; onLoadError?: (message: string) => void };

export const MillieCanvas = forwardRef<MillieHandle, Props>(function MillieCanvas({ active, onLoadError }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<MillieController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useImperativeHandle(ref, () => ({
    say(text) {
      ctrlRef.current?.say(text);
    },
    react(name, hold = 2.5) {
      ctrlRef.current?.react(name, { hold });
    },
    play(name) {
      ctrlRef.current?.play(name);
    },
    pointAt(el) {
      if (!el || !ctrlRef.current || !canvasRef.current) return;
      ctrlRef.current.pointAtElement(el, canvasRef.current);
    },
    stopPointing() {
      ctrlRef.current?.stopPointing();
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let raf = 0;
    let cleanupMove: (() => void) | null = null;
    let ro: ResizeObserver | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderer: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let scene: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let vrm: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let VRMUtils: any = null;

    void (async () => {
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const vrmMod = await import("@pixiv/three-vrm");
      const { MillieController } = await import("./lib/millie.js");
      if (disposed || !host) return;
      VRMUtils = vrmMod.VRMUtils;

      const clock = new THREE.Clock();
      scene = new THREE.Scene();
      // Full body, feet near the canvas bottom so she sits on the ask bar.
      const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
      camera.position.set(0, 0.78, 2.95);
      camera.lookAt(0, 0.62, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.position.set(0.5, 1.5, 2);
      scene.add(key);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      host.appendChild(renderer.domElement);
      canvasRef.current = renderer.domElement;

      const resize = () => {
        if (!renderer || !host) return;
        const w = host.clientWidth || 280;
        const h = host.clientHeight || 320;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(host);

      try {
        const loader = new GLTFLoader();
        loader.register((parser) => new vrmMod.VRMLoaderPlugin(parser));
        const gltf = await loader.loadAsync(VRM_URL);
        if (disposed) return;
        vrm = gltf.userData.vrm;
        VRMUtils.removeUnnecessaryVertices(vrm.scene);
        VRMUtils.combineSkeletons?.(vrm.scene);
        VRMUtils.rotateVRM0(vrm);
        vrm.scene.traverse((o: { frustumCulled?: boolean }) => {
          o.frustumCulled = false;
        });
        scene.add(vrm.scene);
        const millie = new MillieController(vrm, { camera, scene });
        ctrlRef.current = millie;
        millie.play("idle");
        millie.react("happy", { hold: 1.5, intensity: 0.7, fade: 0.4 });
        millie.play("nod");
      } catch (err) {
        onLoadError?.(err instanceof Error ? err.message : "VRM failed to load");
        return;
      }

      const onMove = (e: PointerEvent) => {
        const ctrl = ctrlRef.current;
        const canvas = canvasRef.current;
        if (!ctrl || !canvas) return;
        ctrl.lookAtWorld(ctrl.screenToWorld(e.clientX, e.clientY, canvas.getBoundingClientRect(), 0.55));
      };
      window.addEventListener("pointermove", onMove);
      cleanupMove = () => window.removeEventListener("pointermove", onMove);

      const tick = () => {
        raf = requestAnimationFrame(tick);
        if (!renderer || !scene || !camera) return;
        if (!activeRef.current || document.hidden) return;
        ctrlRef.current?.update(Math.min(clock.getDelta(), 0.05));
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(tick);
    })().catch((err) => {
      onLoadError?.(err instanceof Error ? err.message : "Millie failed to start");
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanupMove?.();
      ro?.disconnect();
      ctrlRef.current = null;
      if (vrm && scene && VRMUtils) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      renderer?.dispose();
      if (renderer?.domElement?.parentElement === host) host.removeChild(renderer.domElement);
      canvasRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className={styles.canvas} aria-hidden />;
});
