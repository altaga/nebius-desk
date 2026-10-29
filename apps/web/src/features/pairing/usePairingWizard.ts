"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  boardLabel,
  configureBoard,
  findLocalBoards,
  httpsBlocksLocalProbe,
  type FoundBoard,
  type SetupStatus,
} from "./localBoard";

export type WizardStep = "scan" | "form" | "code";

type FormState = {
  name: string;
  password: string;
  wifiSsid: string;
  wifiPassword: string;
};

const EMPTY: FormState = { name: "", password: "", wifiSsid: "", wifiPassword: "" };

export function usePairingWizard(onDone: () => void) {
  const [step, setStep] = useState<WizardStep>("scan");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [candidates, setCandidates] = useState<FoundBoard[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

  const patch = useCallback((partial: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...partial }));
    setError(null);
  }, []);

  const selected = candidates.find((row) => row.base === picked) ?? null;
  const canNext = form.name.trim().length > 0 && form.password.length >= 4 && form.wifiSsid.trim().length > 0;

  const claim = useCallback(async (code: string) => {
    await api().claimPair(code);
    setClaimed(true);
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const live = await findLocalBoards();
      setCandidates(live);
      setPicked(live[0]?.base ?? null);
      if (!live.length) {
        setError(
          httpsBlocksLocalProbe()
            ? "No unpaired board answered. If Desk is on HTTPS, open http://localhost:3000/pair so the browser can reach the local board."
            : "No unpaired board on this machine."
        );
      }
    } catch (err) {
      setCandidates([]);
      setPicked(null);
      setError(err instanceof Error ? err.message : "Could not scan for boards.");
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  const confirmPick = useCallback(() => {
    if (!selected) return;
    setError(null);
    setForm((prev) => ({
      ...prev,
      name: prev.name.trim() || boardLabel(selected),
    }));
    setStep("form");
  }, [selected]);

  const submitForm = useCallback(async () => {
    if (!canNext || busy || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await configureBoard(selected.base, {
        name: form.name.trim(),
        password: form.password,
        wifi_ssid: form.wifiSsid.trim(),
        wifi_password: form.wifiPassword,
      });
      setOrigin(selected.base);
      setStatus(next);
      setClaimed(false);
      setStep("code");
      if (!next.code) {
        throw new Error("The board did not return a Pair ID.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set up the board.");
    } finally {
      setBusy(false);
    }
  }, [busy, canNext, claim, form, selected]);

  const retryClaim = useCallback(async () => {
    const code = status?.code;
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      await claim(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setBusy(false);
    }
  }, [busy, claim, status?.code]);

  const back = useCallback(() => {
    setError(null);
    if (step === "code") {
      setStep("form");
      return;
    }
    setStep("scan");
  }, [step]);

  return {
    step,
    form,
    patch,
    canNext,
    busy,
    scanning,
    error,
    status,
    origin,
    claimed,
    candidates,
    picked,
    selected,
    setPicked,
    scan,
    confirmPick,
    submitForm,
    retryClaim,
    onDone,
    back,
  };
}
