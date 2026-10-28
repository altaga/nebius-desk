"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { MillieController } from "./lib/millie.js";
import styles from "./MillieCanvas.module.css";

const VRM_URL = "/millie/millie_chibi_v2_2_web.vrm";

export type MillieHandle = {
  say: (text: string) => void;
  react: (name: string, hold?: number, intensity?: number) => void;
  play: (name: string) => void;
  playing: () => string;
  isBusy: () => boolean;
  pointAt: (el: Element | null) => void;
  stopPointing: () => void;
  /** Tour-only black jacket + glasses; off restores default look. */
  setTourLook: (on: boolean) => void;
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
    react(name, hold = 2.5, intensity = 1) {
      ctrlRef.current?.react(name, { hold, intensity, fade: 0.28 });
    },
    play(name) {
      ctrlRef.current?.play(name, { fade: 0.25 });
    },
    playing() {
      return ctrlRef.current?.playing ?? "idle";
    },
    isBusy() {
      return ctrlRef.current?.busy ?? true;
    },
    pointAt(el) {
      if (!el || !ctrlRef.current || !canvasRef.current) return;
      ctrlRef.current.pointAtElement(el, canvasRef.current);
    },
    stopPointing() {
      ctrlRef.current?.stopPointing();
    },
    setTourLook(on) {
      ctrlRef.current?.setTourLook?.(on);
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
      // Seed framing; after VRM load we fit the camera to her bounds.
      const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
      camera.position.set(0, 0.7, 2.8);
      camera.lookAt(0, 0.55, 0);

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

      const fitCamera = () => {
        if (!vrm || !camera) return;
        const box = new THREE.Box3().setFromObject(vrm.scene);
        if (box.isEmpty()) return;
        const size = box.getSize(new THREE.Vector3());
        // Fill the panel — previous 1.34 pad left big empty bands above head / below feet.
        const targetY = box.min.y + size.y * 0.52;
        const halfH = (size.y * 1.08) / 2;
        const dist = halfH / Math.tan((camera.fov * Math.PI) / 360) / Math.max(camera.aspect, 0.5);
        camera.position.set(0, targetY, dist);
        camera.lookAt(0, targetY, 0);
        camera.updateProjectionMatrix();
      };

      const resize = () => {
        if (!renderer || !host) return;
        const w = host.clientWidth || 280;
        const h = host.clientHeight || 240;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        // true = sync CSS size to buffer so the figure isn't stretched/squashed.
        renderer.setSize(w, h, true);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        fitCamera();
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
        fitCamera();
        const millie = new MillieController(vrm, { camera, scene });
        ctrlRef.current = millie;
        try {
          await millie.initColors?.("/millie/millie_regions.json");
          await millie.colors?.applyBrandedBody?.("/millie/atlas_body_branded.webp");
        } catch {
          /* badge brand is best-effort */
        }
        millie.play("idle");
        millie.react("excited", { hold: 2.8, intensity: 1, fade: 0.28 });
        millie.play("wave");
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
