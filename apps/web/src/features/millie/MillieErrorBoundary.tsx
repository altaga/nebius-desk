"use client";

import { Component, type ReactNode } from "react";
import { MillieLauncher } from "./MillieLauncher";
import styles from "./MillieOverlay.module.css";

type Props = { children: ReactNode };
type State = { error: string | null };

/** Keep a Millie entry point even if the VRM/WebGL path blows up. */
export class MillieErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: Error): State {
    return { error: err.message || "Millie failed to load" };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.fallback} role="alert">
        <MillieLauncher onOpen={() => this.setState({ error: null })} />
        <p className={styles.fallbackMsg}>Millie hit a load error. Click to retry.</p>
      </div>
    );
  }
}
