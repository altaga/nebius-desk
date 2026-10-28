import type { VRM } from "@pixiv/three-vrm";
import type { Camera, Scene, Vector3, WebGLRenderer } from "three";

export class MillieController {
  constructor(vrm: VRM, opts?: { camera?: Camera; scene?: Scene; legs?: boolean });
  legsEnabled: boolean;
  onClipEnd: ((name: string) => void) | null;
  play(name: string, opts?: { fade?: number }): void;
  /** Active non-idle clip name, or `"idle"`. */
  readonly playing: string;
  /** Clip, reaction, point, or talk in progress. */
  readonly busy: boolean;
  react(name: string, opts?: { intensity?: number; hold?: number | null; fade?: number }): void;
  say(text: string, cps?: number): number;
  stopTalking(): void;
  setExpression(name: string, weight: number): void;
  pointAtElement(el: Element, canvas?: Element | null, side?: string): Vector3;
  stopPointing(): void;
  lookAtWorld(target: Vector3 | null): void;
  screenToWorld(x: number, y: number, rect: DOMRect, depth?: number): Vector3;
  update(dt: number): void;
  colors?: {
    applyBrandedBody?: (atlasUrl?: string) => Promise<boolean>;
    stampChestLogo?: (logoUrl?: string) => Promise<boolean>;
    setPalette?: (p: string | Record<string, string>, opt?: { reset?: boolean }) => void;
    reset?: () => void;
    setLeather?: (on: boolean) => void;
  };
  initColors?(url: string): Promise<void>;
  /** Tour-only: animated black jacket + Jensen glasses. Off restores Nebius look. */
  setTourLook?(on: boolean): MillieController;
}

export const REACTION_NAMES: string[];
export const DEMO_CLIPS: string[];
