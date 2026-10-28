import type { GuideAction, GuideEmotion, GuideTarget } from "./guideActions";
import type { SafeClip } from "./safeMotion";

export type TourLang = "es" | "en";

export type TourStep = {
  id: string;
  /** Short chip on the spotlight (UI noun). */
  label: Record<TourLang, string>;
  title: Record<TourLang, string>;
  body: Record<TourLang, string>;
  emotion: GuideEmotion;
  clip: SafeClip;
  /** Open / nav first; highlight last so the target exists. */
  actions: GuideAction[];
  /** ms to wait after open_* before highlight (layout settle). */
  settleMs?: number;
};

function L(es: string, en: string): Record<TourLang, string> {
  return { es, en };
}

/**
 * Static product walkthrough — no LLM.
 * One idea per step; highlight MUST match the copy (the thing named is the thing lit).
 * Order = platform value: fleet → chat/agent → hybrid models → machine shell → secrets → credits.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: "hello",
    label: L("Millie", "Millie"),
    title: L("Hola, soy Millie", "Hi, I'm Millie"),
    body: L("Te enseño el desk en 1 minuto.", "Quick 1-minute desk tour."),
    emotion: "excited",
    clip: "wave",
    actions: [],
  },
  {
    id: "fleet",
    label: L("Boards", "Boards"),
    title: L("Elige el board", "Pick the board"),
    body: L(
      "Aquí están tus Jetsons (Kratos, Natasha…). El seleccionado alimenta Chat, Machine y el panel. Cambia tocando uno.",
      "Your Jetsons live here (Kratos, Natasha…). The selected one feeds Chat, Machine, and the side panel. Tap to switch."
    ),
    emotion: "happy",
    clip: "nod",
    settleMs: 280,
    actions: [{ type: "open_nav" }, { type: "highlight", target: "nav.fleet" }],
  },
  {
    id: "pair",
    label: L("Pair", "Pair"),
    title: L("Sumar un Jetson", "Add a Jetson"),
    body: L(
      "¿Falta uno? Pair crea el código. El board lo escribe una vez y aparece arriba en la flota.",
      "Missing one? Pair makes the code. The board enters it once, then it shows up in the fleet above."
    ),
    emotion: "determined",
    clip: "nod",
    settleMs: 280,
    actions: [{ type: "open_nav" }, { type: "highlight", target: "nav.pair" }],
  },
  {
    id: "chat",
    label: L("Chat", "Chat"),
    title: L("Habla con el agente", "Talk to the agent"),
    body: L(
      "Escribe aquí. El agente del board responde, usa tools y puede tocar el Jetson. Lima = local; azul = Nebius nube.",
      "Type here. The board agent answers, uses tools, and can touch the Jetson. Lime = local; blue = Nebius cloud."
    ),
    emotion: "happy",
    clip: "nod",
    settleMs: 240,
    actions: [{ type: "open_chat" }, { type: "highlight", target: "chat.composer" }],
  },
  {
    id: "model",
    label: L("Modelo", "Model"),
    title: L("Local vs Nebius", "Local vs Nebius"),
    body: L(
      "Auto enruta. Local es gratis en el board. Nano / Lightning / Super son Nebius (créditos). Elige según la tarea.",
      "Auto routes. Local is free on-board. Nano / Lightning / Super are Nebius (credits). Match the job."
    ),
    emotion: "thinking",
    clip: "thinking",
    settleMs: 200,
    actions: [{ type: "open_chat" }, { type: "highlight", target: "chat.model_picker" }],
  },
  {
    id: "terminal",
    label: L("Terminal", "Terminal"),
    title: L("Shell en el Jetson", "Shell on the Jetson"),
    body: L(
      "Machine abre el board en vivo. Terminal = shell real (tú escribes). También hay Health, Files y Services.",
      "Machine opens the live board. Terminal = real shell (you type). Health, Files, and Services sit beside it."
    ),
    emotion: "determined",
    clip: "nod",
    settleMs: 360,
    actions: [{ type: "open_terminal" }, { type: "highlight", target: "machine.terminal" }],
  },
  {
    id: "secrets",
    label: L("Secrets", "Secrets"),
    title: L("Secrets en el board", "Secrets stay on-board"),
    body: L(
      "API keys del Jetson. El agente las usa como env; los valores nunca salen del board — aquí solo ves nombres.",
      "Jetson API keys. The agent uses them as env; values never leave the board — you only see names here."
    ),
    emotion: "smug",
    clip: "nod",
    settleMs: 320,
    actions: [{ type: "open_board" }, { type: "highlight", target: "board.secrets" }],
  },
  {
    id: "plan",
    label: L("Plan", "Plan"),
    title: L("Créditos Nebius", "Nebius credits"),
    body: L(
      "Saldo Nebius y créditos Tavily. Pregúntame “cuánto me queda” cuando quieras un resumen rápido.",
      "Nebius balance and Tavily credits. Ask me “how much do I have left” for a quick summary anytime."
    ),
    emotion: "happy",
    clip: "nod",
    settleMs: 280,
    actions: [{ type: "open_plan" }, { type: "highlight", target: "panel.plan" }],
  },
  {
    id: "done",
    label: L("Listo", "Done"),
    title: L("Ya tienes el mapa", "You've got the map"),
    body: L(
      "Pregúntame “abre la terminal”, “dónde están los secrets”, o “abre Natasha”. /tour repite el tour.",
      "Ask me “open the terminal”, “where are secrets”, or “open Natasha”. /tour replays this tour."
    ),
    emotion: "excited",
    clip: "celebrate",
    actions: [{ type: "open_chat" }],
  },
];

const TARGET_LABELS: Partial<Record<GuideTarget, Record<TourLang, string>>> = {
  "nav.fleet": L("Boards", "Boards"),
  "nav.open_machine": L("Machine", "Machine"),
  "nav.new_chat": L("Nuevo chat", "New chat"),
  "nav.pair": L("Pair", "Pair"),
  "machine.health": L("Health", "Health"),
  "machine.terminal": L("Terminal", "Terminal"),
  "machine.files": L("Files", "Files"),
  "machine.services": L("Services", "Services"),
  "panel.chat": L("Panel Chat", "Chat panel"),
  "panel.board": L("Panel Board", "Board panel"),
  "panel.plan": L("Plan", "Plan"),
  "board.status": L("Status", "Status"),
  "board.memory": L("Memoria", "Memory"),
  "board.experts": L("Experts", "Experts"),
  "board.secrets": L("Secrets", "Secrets"),
  "chat.model_picker": L("Modelo", "Model"),
  "chat.composer": L("Chat", "Chat"),
};

export function labelForTarget(target: GuideTarget | null, lang: TourLang): string | null {
  if (!target) return null;
  return TARGET_LABELS[target]?.[lang] ?? target.split(".").pop() ?? null;
}

export function isTourCommand(raw: string): boolean {
  const t = raw.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (!t) return false;
  if (t === "/tour" || t === "tour") return true;
  if (t === "presentate" || t === "/presentate") return true;
  return false;
}

/** Hands-free walkthrough — each step advances after at most AUTO_TOUR_STEP_MS. */
export const AUTO_TOUR_STEP_MS = 5_000;
/** /autotour intro beat (keep in sync with setTourLook on-duration). */
export const AUTO_TOUR_CENTER_MS = 400;
export const AUTO_TOUR_JACKET_MS = 400;
export const AUTO_TOUR_GRACE_MS = 400;

export function isAutoTourCommand(raw: string): boolean {
  const t = raw.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return t === "/autotour" || t === "autotour";
}

/** Any tour kickoff that should bypass the board requirement. */
export function isAnyTourCommand(raw: string): boolean {
  return isTourCommand(raw) || isAutoTourCommand(raw);
}

/** Room above the dock for Millie's dialogue bubble (must stay on-screen). */
export const TOUR_BUBBLE_ROOM = 158;

/** Hello / done: center stage, with headroom for the bubble above her. */
export function tourCenterPos(width: number, height: number, edge = 8): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  const vw = window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const minY = edge + TOUR_BUBBLE_ROOM;
  const maxY = Math.max(minY, vh - height - edge);
  return {
    x: Math.max(edge, Math.round((vw - width) / 2)),
    y: Math.min(maxY, Math.max(minY, Math.round((vh - height) / 2))),
  };
}

/**
 * Highlight steps: stand *next to* the lit control (short point), not across the screen.
 * Prefer the side closer to viewport center so step-to-step moves stay small.
 */
export function tourClearPos(
  width: number,
  height: number,
  highlight: DOMRect | null,
  edge = 8
): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  if (!highlight) return tourCenterPos(width, height, edge);

  const vw = window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const gap = 18;
  const pad = 20;
  const minY = edge + TOUR_BUBBLE_ROOM;
  const clampX = (x: number) => Math.max(edge, Math.min(vw - width - edge, Math.round(x)));
  const clampY = (y: number) => Math.max(minY, Math.min(vh - height - edge, Math.round(y)));
  const cx = highlight.left + highlight.width / 2;
  const cy = highlight.top + highlight.height / 2;
  const mid = vw / 2;

  const overlaps = (x: number, y: number) =>
    x < highlight.right + pad &&
    x + width > highlight.left - pad &&
    y < highlight.bottom + pad &&
    y + height > highlight.top - pad;

  const rightX = highlight.right + gap;
  const leftX = highlight.left - width - gap;
  const fitsRight = rightX + width <= vw - edge;
  const fitsLeft = leftX >= edge;

  let x: number;
  if (fitsRight && fitsLeft) {
    // Pick the adjacent side nearer the screen center (less teleports).
    const rC = rightX + width / 2;
    const lC = leftX + width / 2;
    x = Math.abs(rC - mid) <= Math.abs(lC - mid) ? rightX : leftX;
  } else if (fitsRight) {
    x = rightX;
  } else if (fitsLeft) {
    x = leftX;
  } else {
    x = cx - width / 2;
  }

  // Align vertically with the target — Millie points sideways, not diagonal across the desk.
  let y = cy - height * 0.42;

  x = clampX(x);
  y = clampY(y);

  if (!overlaps(x, y)) return { x, y };

  // Still overlapping (tall target / narrow gap): try below, then above, still near cx.
  const below = highlight.bottom + gap;
  const above = highlight.top - height - gap;
  if (below + height <= vh - edge && !overlaps(clampX(cx - width / 2), clampY(below))) {
    return { x: clampX(cx - width / 2), y: clampY(below) };
  }
  if (above >= edge && !overlaps(clampX(cx - width / 2), clampY(above))) {
    return { x: clampX(cx - width / 2), y: clampY(above) };
  }

  // Last resort: nudge further on the chosen side, same vertical band.
  x = clampX(cx < mid ? highlight.right + gap + 12 : highlight.left - width - gap - 12);
  y = clampY(cy - height * 0.42);
  return { x, y };
}
