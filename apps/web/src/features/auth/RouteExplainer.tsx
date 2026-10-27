import styles from "./LoginScreen.module.css";

const EXAMPLE = [
  { route: "edge", where: "Jetson", ask: "Summarize today's sensor log", result: "handled locally · $0" },
  { route: "cloud", where: "Nebius", ask: "Design a retry strategy for the uplink", result: "1,240 → 310 tokens" },
  { route: "edge", where: "Jetson", ask: "Remember: gateway IP is 10.0.0.4", result: "saved to shared memory" },
] as const;

export function RouteExplainer() {
  return (
    <aside className={styles.explain} aria-label="How NebiusDesk routes work">
      <div className={styles.explainInner}>
        <p className={styles.eyebrow}>How it works</p>
        <h2>
          Install the agent on the Jetson.
          <br />
          <span>The subscription opens the remote desk.</span>
        </h2>
        <p className={styles.explainText}>
          Advanced tools run on that box. Hard reasoning goes to Nebius and search goes to Tavily,
          inside the allowance that comes with the plan.
        </p>
        <ol className={styles.trace} aria-label="Example routing">
          {EXAMPLE.map((row) => (
            <li key={row.ask} data-route={row.route}>
              <span className={styles.traceWhere}>{row.where}</span>
              <span className={styles.traceAsk}>{row.ask}</span>
              <span className={styles.traceResult}>{row.result}</span>
            </li>
          ))}
        </ol>
        <p className={styles.caption}>Example trace</p>
      </div>
    </aside>
  );
}
