"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useDeskGuideOptional, type ComposerCue } from "./DeskGuideContext";
import type { MillieHandle } from "./MillieCanvas";

const DIZZY_SPEED = 2700; // px/s — fast sweeps (a bit less sensitive)
const DIZZY_HOLD_MS = 110;
const DIZZY_COOLDOWN_MS = 9_000;
const AMBIENT_MIN_MS = 55_000;
const AMBIENT_MAX_MS = 95_000;
/** Dizzy / typing / paste / ambient bubbles. */
const PRESENCE_LINE_MS = 8000;
const CHEER_COOLDOWN_MS = 12_000;
const PASTE_COOLDOWN_MS = 14_000;

type Lang = "es" | "en";

type Beat = {
  id: string;
  weight: number;
  react: string;
  clip: string;
  hold?: number;
  line: Record<Lang, string>;
};

const AMBIENT_BEATS: Beat[] = [
  {
    id: "peek",
    weight: 3,
    react: "wink",
    clip: "nod",
    line: { es: "¿Todo bien por aquí?", en: "Everything okay over there?" },
  },
  {
    id: "shy",
    weight: 2,
    react: "shy",
    clip: "bow",
    line: { es: "Si te pierdes, pregúntame.", en: "If you get lost, just ask me." },
  },
  {
    id: "smug",
    weight: 2,
    react: "smug",
    clip: "wave",
    line: { es: "Yo sé dónde está cada botón.", en: "I know where every button lives." },
  },
  {
    id: "curious",
    weight: 2,
    react: "thinking",
    clip: "thinking",
    hold: 2.4,
    line: { es: "¿Quieres que te señale algo?", en: "Want me to point something out?" },
  },
  {
    id: "cheer",
    weight: 1,
    react: "happy",
    clip: "celebrate",
    line: { es: "¡Sigamos!", en: "Let's keep going!" },
  },
  {
    id: "sleepy",
    weight: 1,
    react: "sleepy",
    clip: "idle",
    hold: 3,
    line: { es: "Sigo aquí si me necesitas…", en: "Still here if you need me…" },
  },
];

function pickBeat(): Beat {
  const total = AMBIENT_BEATS.reduce((s, b) => s + b.weight, 0);
  let r = Math.random() * total;
  for (const beat of AMBIENT_BEATS) {
    r -= beat.weight;
    if (r <= 0) return beat;
  }
  return AMBIENT_BEATS[0];
}

function nightish(): boolean {
  const h = new Date().getHours();
  return h >= 23 || h < 6;
}

type Options = {
  millieRef: RefObject<MillieHandle | null>;
  enabled: boolean;
  /** Guide turn, typing, drag, spotlight — blocks presence. */
  busy: boolean;
  lang?: Lang;
  onLine?: (text: string | null) => void;
};

/** Fast-mouse dizzy + rare ambient beats + composer cheer/paste. Never interrupts an active Millie clip. */
export function useMilliePresence({ millieRef, enabled, busy, lang = "en", onLine }: Options) {
  const desk = useDeskGuideOptional();
  const busyRef = useRef(busy);
  const langRef = useRef(lang);
  const onLineRef = useRef(onLine);
  busyRef.current = busy;
  langRef.current = lang;
  onLineRef.current = onLine;

  // --- composer: fast typing cheer + long-paste "interested" ---
  useEffect(() => {
    if (!enabled || !desk) return;
    let cheerUntil = 0;
    let pasteUntil = 0;
    let lineClear: number | null = null;

    const say = (line: string) => {
      onLineRef.current?.(line);
      if (lineClear != null) window.clearTimeout(lineClear);
      lineClear = window.setTimeout(() => onLineRef.current?.(null), PRESENCE_LINE_MS);
    };

    const onCue = (cue: ComposerCue) => {
      if (busyRef.current) return;
      const m = millieRef.current;
      if (!m || m.isBusy()) return;
      const now = performance.now();
      const L = langRef.current;

      if (cue.kind === "fast_type") {
        if (now < cheerUntil) return;
        cheerUntil = now + CHEER_COOLDOWN_MS;
        m.react("excited", 2.2, 1);
        m.play("celebrate");
        say(L === "es" ? "¡Eso, dale! ¡Tú puedes!" : "Go go go — you've got this!");
        return;
      }

      if (cue.kind === "long_paste") {
        if (now < pasteUntil) return;
        pasteUntil = now + PASTE_COOLDOWN_MS;
        m.react("surprised", 2.6, 1);
        m.play("thinking");
        const n = cue.chars ?? 0;
        say(
          L === "es"
            ? n > 800
              ? "Uy… eso se ve jugoso. Cara de interesada activada."
              : "Ooh, interesante — a ver qué traes."
            : n > 800
              ? "Whoa, that's a novel — I'm intrigued."
              : "Ooh, interesting — lay it on me."
        );
      }
    };

    const unsub = desk.subscribeComposerCue(onCue);
    return () => {
      unsub();
      if (lineClear != null) window.clearTimeout(lineClear);
    };
  }, [enabled, desk, millieRef]);

  // --- dizzy ---
  useEffect(() => {
    if (!enabled) return;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let fastSince = 0;
    let coolUntil = 0;
    let lineClear: number | null = null;

    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (!lastT) {
        lastX = e.clientX;
        lastY = e.clientY;
        lastT = now;
        return;
      }
      const dt = (now - lastT) / 1000;
      lastT = now;
      if (dt <= 0 || dt > 0.25) {
        lastX = e.clientX;
        lastY = e.clientY;
        fastSince = 0;
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const speed = Math.hypot(dx, dy) / dt;

      if (speed < DIZZY_SPEED) {
        fastSince = 0;
        return;
      }
      if (!fastSince) fastSince = now;
      if (now - fastSince < DIZZY_HOLD_MS) return;
      if (now < coolUntil) return;
      if (busyRef.current) return;

      const m = millieRef.current;
      if (!m || m.isBusy()) return;

      coolUntil = now + DIZZY_COOLDOWN_MS;
      fastSince = 0;
      const L = langRef.current;
      m.react("flustered", 1.6, 1);
      m.play("shake");
      const line = L === "es" ? "¡Whoa, más despacio!" : "Whoa — slow down a bit!";
      onLineRef.current?.(line);
      if (lineClear != null) window.clearTimeout(lineClear);
      lineClear = window.setTimeout(() => onLineRef.current?.(null), PRESENCE_LINE_MS);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (lineClear != null) window.clearTimeout(lineClear);
    };
  }, [enabled, millieRef]);

  // --- ambient ---
  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    let lineClear: number | null = null;
    let cancelled = false;

    const schedule = () => {
      const wait = AMBIENT_MIN_MS + Math.random() * (AMBIENT_MAX_MS - AMBIENT_MIN_MS);
      timer = window.setTimeout(tick, wait);
    };

    const tick = () => {
      if (cancelled) return;
      schedule();
      if (document.hidden || busyRef.current) return;
      const m = millieRef.current;
      if (!m || m.isBusy()) return;

      let beat = pickBeat();
      if (nightish() && Math.random() < 0.55) {
        beat = AMBIENT_BEATS.find((b) => b.id === "sleepy") || beat;
      }

      m.react(beat.react, beat.hold ?? 2.4, 0.95);
      if (beat.clip !== "idle") m.play(beat.clip);
      const line = beat.line[langRef.current];
      onLineRef.current?.(line);
      if (lineClear != null) window.clearTimeout(lineClear);
      lineClear = window.setTimeout(() => onLineRef.current?.(null), PRESENCE_LINE_MS);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      if (lineClear != null) window.clearTimeout(lineClear);
    };
  }, [enabled, millieRef]);
}
