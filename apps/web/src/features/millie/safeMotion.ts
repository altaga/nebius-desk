/**
 * Curated Millie motions after visual QA on chibi v2.2.
 * Dropped anything with waist gaps, mesh crosses, hand/hair clipping, or chin bleed.
 */

export const SAFE_CLIPS = ["idle", "nod", "shake", "thinking"] as const;

export const SAFE_REACTIONS = [
  "neutral",
  "happy",
  "excited",
  "relaxed",
  "sleepy",
  "laugh",
  "cat",
  "determined",
] as const;

export const SAFE_OVERLAYS = ["Blush", "Sparkles", "Hearts"] as const;

export type SafeClip = (typeof SAFE_CLIPS)[number];
export type SafeReaction = (typeof SAFE_REACTIONS)[number];

const CLIP_SET = new Set<string>(SAFE_CLIPS);
const REACT_SET = new Set<string>(SAFE_REACTIONS);

export function pickSafeClip(name: string, fallback: SafeClip = "idle"): SafeClip {
  return CLIP_SET.has(name) ? (name as SafeClip) : fallback;
}

export function pickSafeReaction(name: string, fallback: SafeReaction = "happy"): SafeReaction {
  return REACT_SET.has(name) ? (name as SafeReaction) : fallback;
}

/** Fallback when Nano omits the react tool — never invents a glitchy name. */
export function reactionForGuide(text: string): SafeReaction {
  const t = text.toLowerCase();
  if (/hola|hello|hi\b|hey|gracias|thank|bienven/.test(t)) return "happy";
  if (/error|fail|broken|ayuda|help|stuck|problema/.test(t)) return "determined";
  if (/terminal|machine|board|setup|pair|abre|open/.test(t)) return "determined";
  if (/jaja|lol|funny|gracioso/.test(t)) return "laugh";
  if (/bien|ok|listo|done|perfecto/.test(t)) return "excited";
  if (/descanso|tired|noche/.test(t)) return "sleepy";
  return "happy";
}

/** Zero-token local replies for trivial turns — skips Nano entirely. */
export type LocalGuideReply = { text: string; emotion: SafeReaction };

export function localGuideReply(userText: string): LocalGuideReply | null {
  const t = userText.trim().toLowerCase();
  if (!t || t.length > 80) return null;
  if (/^(hola|hello|hi|hey|buenas|buen[oa]s?\s*(d[ií]as|tardes|noches)?)[!?.]*$/i.test(t)) {
    return {
      text: "Hi — I’m Millie. Ask me where things are; I’ll open tabs and point.",
      emotion: "happy",
    };
  }
  if (/^(qui[eé]n eres|who are you|qu[eé] eres|what are you)[!?.]*$/i.test(t)) {
    return {
      text: "I am Millie, your UI guide. I explain setups and highlight controls. Your cloud Nano turn only runs when you need a real how-to.",
      emotion: "happy",
    };
  }
  if (/^(gracias|thanks|thank you|ty)[!?.]*$/i.test(t)) {
    return { text: "Anytime — ask whenever you get stuck.", emotion: "happy" };
  }
  if (/^(ok|okay|vale|listo|perfecto|done|bien)[!?.]*$/i.test(t)) {
    return { text: "Got it.", emotion: "excited" };
  }
  return null;
}
