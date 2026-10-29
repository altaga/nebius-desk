import styles from "./LoginScreen.module.css";

const EXAMPLE = [
  { route: "edge", where: "Jetson", ask: "Summarize today's sensor log", result: "local · $0" },
  { route: "cloud", where: "Nebius", ask: "Design a retry strategy for the uplink", result: "1,240 → 310 tokens" },
  { route: "edge", where: "Jetson", ask: "Remember: the gateway IP is 10.0.0.4", result: "saved to memory" },
] as const;

const POINTS = [
  ["On-device first", "Everyday turns run on the Jetson, free and private."],
  ["Cloud on purpose", "Hard reasoning goes to Nemotron on Nebius, compressed first."],
  ["Cost on every reply", "You always see where a message ran and what it spent."],
] as const;

export function RouteExplainer() {
  return (
    <aside className={styles.explain} aria-label="How Nebius Desk routes your requests">
      <div className={styles.explainInner}>
        <p className={styles.eyebrow}>How the desk thinks</p>
        <h2>
          Local first.
          <br />
          <span>Cloud when it counts.</span>
        </h2>
        <p className={styles.explainText}>
          Your Jetson handles the everyday work. When a question needs more reasoning, Desk sends a
          compressed version to Nebius, and pulls live facts from Tavily when the answer depends on
          today.
        </p>
        <ol className={styles.trace} aria-label="Example routing">
          {EXAMPLE.map((row, i) => (
            <li key={row.ask} data-route={row.route} style={{ animationDelay: `${0.2 + i * 0.35}s` }}>
              <span className={styles.traceWhere}>{row.where}</span>
              <span className={styles.traceAsk}>{row.ask}</span>
              <span className={styles.traceResult}>{row.result}</span>
            </li>
          ))}
        </ol>
        <p className={styles.caption}>Example trace · illustrative values</p>
        <ul className={styles.points}>
          {POINTS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
