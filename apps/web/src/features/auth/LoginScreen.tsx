"use client";

import { useState, type FormEvent } from "react";
import { loginAction } from "@/app/actions/auth";
import { RouteExplainer } from "@/features/auth/RouteExplainer";
import { markSession } from "@/lib/api";
import { BrandMark } from "@/ui/BrandMark";
import styles from "./LoginScreen.module.css";

type Props = {
  onAuthed: () => void;
};

type FormState = "idle" | "submitting" | "error";

export function LoginScreen({ onAuthed }: Props) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<FormState>("idle");

  const canSubmit = Boolean(username.trim() && password) && state !== "submitting";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setState("submitting");
    setError(null);
    try {
      const res = await loginAction(username.trim(), password);
      if (!res.ok) {
        setError(res.error);
        setState("error");
        return;
      }
      markSession(true);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setState("error");
    }
  }

  const clearError = () => state === "error" && setState("idle");

  return (
    <main className={styles.wrap}>
      <section className={styles.side} aria-busy={state === "submitting"}>
        <header className={styles.brand}>
          <BrandMark size={26} />
          <span>
            Nebius<b>Desk</b>
          </span>
        </header>

        <div className={styles.formArea}>
          <h1>Sign in</h1>
          <p className={styles.sub}>Your devices, their agents, and shared memory.</p>

          <form className={styles.form} onSubmit={onSubmit} noValidate>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearError();
                }}
                autoComplete="username"
                disabled={state === "submitting"}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError();
                }}
                autoComplete="current-password"
                autoFocus
                disabled={state === "submitting"}
                required
              />
            </label>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={!canSubmit}>
              {state === "submitting" ? "Signing in…" : "Continue"}
            </button>
          </form>
        </div>

        <footer className={styles.foot}>Private desk · access is limited to enrolled operators</footer>
      </section>

      <RouteExplainer />
    </main>
  );
}
