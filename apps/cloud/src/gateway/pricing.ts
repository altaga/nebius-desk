/** Token Factory list prices from Nebius' public catalog, cached per isolate. */

type Price = { input_per_m: number; output_per_m: number };

const CATALOG_URL = "https://tokenfactory.nebius.com/api/public/models_info";
const CACHE_MS = 6 * 3600 * 1000;
const DEFAULT: Price = { input_per_m: 0.3, output_per_m: 0.9 };
const FALLBACK: Record<string, Price> = {
  "nvidia/Nemotron-3_5-Lightning": { input_per_m: 0.06, output_per_m: 0.24 },
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": { input_per_m: 0.06, output_per_m: 0.24 },
  "nvidia/nemotron-3-super-120b-a12b": { input_per_m: 0.3, output_per_m: 0.9 },
  "nvidia/Nemotron-3-Ultra-550b-a55b": { input_per_m: 1, output_per_m: 3 },
};

let cache: Record<string, Price> = {};
let loadedAt = 0;

async function refresh(): Promise<void> {
  try {
    const res = await fetch(CATALOG_URL, { cf: { cacheTtl: 3600 } });
    if (!res.ok) return;
    const models = (await res.json()) as Array<{ flavors?: Array<Record<string, unknown>> }>;
    const next: Record<string, Price> = {};
    for (const m of Array.isArray(models) ? models : []) {
      for (const f of m.flavors ?? []) {
        const id = f.model_id as string | undefined;
        const input = f.input_price_per_million_tokens as number | undefined;
        if (!id || input == null) continue;
        next[id] = { input_per_m: Number(input), output_per_m: Number(f.output_price_per_million_tokens ?? 0) };
      }
    }
    if (Object.keys(next).length) {
      cache = next;
      loadedAt = Date.now();
    }
  } catch (err) {
    console.warn("catalog unavailable", String(err));
  }
}

export async function priceOf(model: string): Promise<Price> {
  if (Date.now() - loadedAt > CACHE_MS) await refresh();
  return cache[model] ?? FALLBACK[model] ?? DEFAULT;
}

export async function costUsd(model: string, promptTokens: number, completionTokens: number): Promise<number> {
  const p = await priceOf(model);
  return (promptTokens * p.input_per_m + completionTokens * p.output_per_m) / 1_000_000;
}
