"use client";

import { useEffect, useState } from "react";

export const THINKING_PHRASES = [
  "Thinking",
  "Pondering",
  "Turning it over",
  "Connecting the dots",
  "Reading it again",
  "Finding the thread",
  "Letting it settle",
  "Working it out",
  "Following the thought",
  "Putting it together",
  "Mulling it over",
  "Looking closer",
];

const STEP_MS = 2400;

export function useThinkingPhrase(active: boolean): string {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    const id = window.setInterval(() => setStep((n) => n + 1), STEP_MS);
    return () => window.clearInterval(id);
  }, [active]);

  return THINKING_PHRASES[step % THINKING_PHRASES.length];
}
