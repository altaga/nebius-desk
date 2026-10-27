const MODEL_LABELS: Record<string, string> = {
  "nvidia/nemotron-3-super-120b-a12b": "Super",
  "nvidia/nemotron-3-super": "Super",
  "nvidia/nemotron-3_5-lightning": "Lightning",
  "nvidia/nemotron-3.5-lightning": "Lightning",
  "nvidia/nvidia-nemotron-3-nano-30b-a3b": "Nano",
  "nvidia/nemotron-3-nano": "Nano",
  "nvidia/nemotron-3-ultra-550b-a55b": "Ultra",
  "qwen2.5:1.5b": "Qwen",
};

export function shortModel(model?: string): string {
  const raw = (model ?? "").trim();
  if (!raw) return "";
  const known = MODEL_LABELS[raw.toLowerCase()];
  if (known) return known;
  const slug = (raw.split("/").pop() ?? raw).toLowerCase();
  if (slug.includes("nemotron") && slug.includes("super")) return "Super";
  if (slug.includes("ultra")) return "Ultra";
  if (slug.includes("lightning")) return "Lightning";
  if (slug.includes("nano")) return "Nano";
  if (slug.startsWith("qwen")) return "Qwen";
  return raw.split("/").pop() ?? raw;
}

const PINNED_LABEL: Record<string, string> = {
  local: "Local",
  nano: "Nano",
  fast: "Lightning",
  heavy: "Super",
  ultra: "Ultra",
};

export function pinnedModelLabel(choice: string): string {
  return PINNED_LABEL[choice] ?? "";
}

export function fmtCost(usd?: number): string {
  if (!usd) return "$0";
  if (usd < 0.0001) return "<$0.0001";
  return `$${usd.toFixed(usd < 0.01 ? 4 : 3)}`;
}

export function fmtCount(n?: number): string {
  if (!n) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function fmtMs(ms?: number): string {
  if (!ms) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
