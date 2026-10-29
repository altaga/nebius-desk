"use client";

import { useState, type FormEvent } from "react";
import { loginAction } from "@/app/actions/auth";
import { markSession } from "@/lib/api";

type FormState = "idle" | "submitting" | "error";

/** Turns raw API/network failures into a sentence a person can act on. */
export function friendlyLoginError(raw: string): string {
  let text = raw;
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; error?: unknown };
    const detail = parsed.detail ?? parsed.error;
    if (typeof detail === "string") text = detail;
  } catch {
    /* not JSON */
  }
  const t = text.toLowerCase();
  if (/(401|403|invalid|incorrect|credentials|unauthori)/.test(t)) {
    return "That username and password don't match. Check them and try again.";
  }
  if (/(429|too many|rate)/.test(t)) return "Too many attempts. Wait a minute, then try again.";
  if (/(fetch failed|network|econn|timeout|502|503|504)/.test(t)) {
    return "We can't reach your desk right now. Make sure the Jetson is online, then try again.";
  }
  return text || "Sign-in didn't go through. Please try again.";
}

export function useLoginForm(onAuthed: () => void) {
  const [username, setUsernameRaw] = useState("admin");
  const [password, setPasswordRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<FormState>("idle");

  const submitting = state === "submitting";
  const canSubmit = Boolean(username.trim() && password) && !submitting;
  const clearError = () => state === "error" && (setState("idle"), setError(null));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setState("submitting");
    setError(null);
    try {
      const res = await loginAction(username.trim(), password);
      if (!res.ok) {
        setError(friendlyLoginError(res.error));
        setState("error");
        return;
      }
      markSession(true);
      onAuthed();
    } catch (err) {
      setError(friendlyLoginError(err instanceof Error ? err.message : ""));
      setState("error");
    }
  }

  return {
    username,
    password,
    error,
    submitting,
    canSubmit,
    onSubmit,
    setUsername: (v: string) => (setUsernameRaw(v), clearError()),
    setPassword: (v: string) => (setPasswordRaw(v), clearError()),
  };
}
