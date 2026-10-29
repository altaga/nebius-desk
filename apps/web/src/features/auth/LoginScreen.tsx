"use client";

import { RouteExplainer } from "@/features/auth/RouteExplainer";
import { BrandMark } from "@/ui/BrandMark";
import { PasswordField } from "./PasswordField";
import { useLoginForm } from "./useLoginForm";
import styles from "./LoginScreen.module.css";

type Props = {
  onAuthed: () => void;
};

export function LoginScreen({ onAuthed }: Props) {
  const form = useLoginForm(onAuthed);

  return (
    <main className={styles.wrap}>
      <section className={styles.side} aria-busy={form.submitting}>
        <header className={styles.top}>
          <a className={styles.brand} href="/" aria-label="Nebius Desk home">
            <BrandMark size={26} />
            <span>
              Nebius<b>Desk</b>
            </span>
          </a>
          <a className={styles.back} href="/">
            ← Back to site
          </a>
        </header>

        <div className={styles.formArea}>
          <p className={styles.kicker}>
            <span className={styles.dot} aria-hidden />
            Secure sign-in
          </p>
          <h1>Welcome back.</h1>
          <p className={styles.sub}>Sign in to reach your Jetson, its agents, and your shared memory.</p>

          <form className={styles.form} onSubmit={form.onSubmit} noValidate>
            <div className={styles.field}>
              <label htmlFor="login-username">Username</label>
              <input
                id="login-username"
                value={form.username}
                onChange={(e) => form.setUsername(e.target.value)}
                autoComplete="username"
                spellCheck={false}
                disabled={form.submitting}
                required
              />
            </div>
            <PasswordField value={form.password} onChange={form.setPassword} disabled={form.submitting} />
            {form.error ? (
              <p className={styles.error} role="alert">
                {form.error}
              </p>
            ) : null}
            <button type="submit" className={styles.submit} disabled={!form.canSubmit}>
              {form.submitting ? (
                <>
                  <span className={styles.spinner} aria-hidden />
                  Opening your desk…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>

        <footer className={styles.foot}>
          Private desk · Access is limited to enrolled operators.
        </footer>
      </section>

      <RouteExplainer />
    </main>
  );
}
