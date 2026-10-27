"use client";

import { usePolled } from "@/features/panel/usePolled";
import { api } from "@/lib/api";

export function useModels() {
  return usePolled(() => api().models(), 5 * 60_000);
}

export type ModelsState = ReturnType<typeof useModels>;
