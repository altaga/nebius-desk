import styles from "./ChatPane.module.css";

const STARTERS = [
  {
    label: "Summarize shared memory",
    prompt: "Summarize the memory files on this device and flag anything outdated.",
  },
  {
    label: "Plan a task across edge and cloud",
    prompt: "Plan this task and tell me which steps should run on the Jetson vs Nebius: ",
  },
  {
    label: "Explain a log or error",
    prompt: "Explain this error and propose a fix:\n\n",
  },
];

const EMU_STARTERS = [
  {
    label: "Ask a short question",
    prompt: "In a few sentences, explain: ",
  },
  {
    label: "Help with everyday code",
    prompt: "Help me with this coding task:\n\n",
  },
  {
    label: "Think through a hard problem",
    prompt: "Think step by step about this:\n\n",
  },
];

type Props = {
  deviceName: string;
  onPick: (prompt: string) => void;
  cloudOnly?: boolean;
};

export function EmptyState({ deviceName, onPick, cloudOnly = false }: Props) {
  const starters = cloudOnly ? EMU_STARTERS : STARTERS;
  return (
    <div className={styles.empty}>
      <p className={styles.kicker}>
        <span className={styles.dot} aria-hidden /> {deviceName} · ready
      </p>
      <h2>Start a chat on {deviceName}</h2>
      <p className={styles.lede}>
        {cloudOnly
          ? "This Docker board has no local Qwen. Pick Nano, Lightning, or Super — answers go through Nebius and use your cloud credits."
          : "Light work stays on the Jetson. Heavy reasoning goes to Nebius, compressed first. Every chat here reads this device's memory files. Call an expert with @Name when you want that profile's angle."}
      </p>
      <ul className={styles.starters}>
        {starters.map((s) => (
          <li key={s.label}>
            <button type="button" onClick={() => onPick(s.prompt)}>
              {s.label}
              <span aria-hidden>→</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
