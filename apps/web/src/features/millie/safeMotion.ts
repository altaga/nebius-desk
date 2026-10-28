/**
 * Curated Millie motions after visual QA on chibi v2.2.
 * Keep in sync with apps/api GUIDE_EMOTIONS and guideActions EMOTIONS.
 */

export const SAFE_CLIPS = ["idle", "wave", "nod", "shake", "thinking", "celebrate", "bow"] as const;

export const SAFE_REACTIONS = [
  "neutral",
  "happy",
  "excited",
  "love",
  "shy",
  "surprised",
  "sleepy",
  "relaxed",
  "wink",
  "thinking",
  "determined",
  "smug",
  "laugh",
  "cat",
  "apologetic",
  "pout",
  "flustered",
  "sad",
] as const;

export const SAFE_OVERLAYS = ["Blush", "Sparkles", "Hearts"] as const;

export type SafeClip = (typeof SAFE_CLIPS)[number];
export type SafeReaction = (typeof SAFE_REACTIONS)[number];

const CLIP_SET = new Set<string>(SAFE_CLIPS);
const REACT_SET = new Set<string>(SAFE_REACTIONS);

/** Opening line — local UI chrome, not a Nano reply. */
export const MILLIE_INTRO: Record<"es" | "en", string> = {
  es: "¡Hola, soy Millie! Me sé este desk de memoria. Pídeme que te encuentre o abra lo que sea.",
  en: "Hey, I'm Millie! I know this desk inside out. Ask me to find or open anything.",
};

export const MILLIE_PLACEHOLDER: Record<"es" | "en", { ready: string; noBoard: string }> = {
  es: { ready: "Pregúntame algo… o escribe /tour", noBoard: "Elige un board primero… o escribe /tour" },
  en: { ready: "Ask me anything… or type /tour", noBoard: "Pick a board first… or type /tour" },
};

export function pickSafeClip(name: string, fallback: SafeClip = "idle"): SafeClip {
  return CLIP_SET.has(name) ? (name as SafeClip) : fallback;
}

export function pickSafeReaction(name: string, fallback: SafeReaction = "happy"): SafeReaction {
  return REACT_SET.has(name) ? (name as SafeReaction) : fallback;
}

/** Fallback when Nano omits the react tool — never invents a glitchy name. */
export function reactionForGuide(text: string): SafeReaction {
  const t = text.toLowerCase();
  if (/jaja|lol|funny|gracioso|haha/.test(t)) return "laugh";
  if (/amor|love|❤|heart|lindo|cute/.test(t)) return "love";
  if (/gracias|thanks|thank|de nada|anytime/.test(t)) return "shy";
  if (/hola|hello|hi\b|hey|bienven|welcome/.test(t)) return "excited";
  if (/wink|guiño|😉/.test(t)) return "wink";
  if (/cat|nya|miau|🐱/.test(t)) return "cat";
  if (/sorry|perdon|perdón|oops|apolog|fall[oó]|error|fail|broken/.test(t)) return "apologetic";
  if (/triste|sad|ugh|pout|enoja/.test(t)) return "pout";
  if (/sorprend|wow|wait|oh\b|¡/.test(t)) return "surprised";
  if (/fluster|nervous|espera|umm/.test(t)) return "flustered";
  if (/descanso|tired|noche|sleep|zzz/.test(t)) return "sleepy";
  if (/relax|calm|tranqui|okey/.test(t)) return "relaxed";
  if (/listo|done|perfecto|ready|opened|abr[ií]/.test(t)) return "excited";
  if (/terminal|machine|board|setup|pair|help|ayuda|stuck|problema|determin/.test(t)) return "determined";
  if (/pien|think|hmm|mir[ae]/.test(t)) return "thinking";
  if (/smug|heh|claro|obvio/.test(t)) return "smug";
  return "happy";
}

/** Clip that pairs well with a reaction after a guide turn. */
export function clipForReaction(emotion: SafeReaction): SafeClip {
  switch (emotion) {
    case "excited":
    case "love":
    case "laugh":
    case "cat":
      return "celebrate";
    case "apologetic":
    case "sad":
    case "shy":
      return "bow";
    case "thinking":
    case "flustered":
      return "thinking";
    case "surprised":
      return "shake";
    case "wink":
    case "happy":
    case "smug":
      return "wave";
    case "determined":
      return "nod";
    default:
      return "nod";
  }
}
