import styles from "./ChatPane.module.css";

const STARTERS = [
  {
    label: "Summarize board memory",
    hint: "Get a quick briefing from the saved memory files on this device.",
    prompt: "Summarize the memory files on this device and flag anything outdated.",
    example: "Example: summarize the board memory and tell me what is stale.",
  },
  {
    label: "Plan work across edge and cloud",
    hint: "Ask which steps belong on the Jetson and which should go to Nebius.",
    prompt: "Plan this task and tell me which steps should run on the Jetson vs Nebius: ",
    example: "Example: plan a browser test flow and split edge work from cloud work.",
  },
  {
    label: "Explain an error",
    hint: "Paste a stack trace or log and ask for a diagnosis.",
    prompt: "Explain this error and propose a fix:\n\n",
    example: "Example: explain this traceback and propose the smallest fix.",
  },
  {
    label: "Inspect the live board",
    hint: "Ask the assistant to review health, files, services, and current state.",
    prompt: "Inspect this board and summarize its health, files, services, and any issues you notice.",
    example: "Example: inspect the board and tell me what looks healthy or suspicious.",
  },
];

const EMU_STARTERS = [
  {
    label: "Inspect this cloud board",
    hint: "Use the real health, files, services, and runtime surfaces on this VM.",
    prompt: "Inspect this cloud board and summarize its health, files, services, and current runtime.",
    example: "Example: inspect the cloud board and tell me what is running right now.",
  },
  {
    label: "Help with code",
    hint: "Use the cloud model for ordinary coding help on this machine.",
    prompt: "Help me with this coding task:\n\n",
    example: "Example: help me refactor this React component.",
  },
  {
    label: "Think through a hard problem",
    hint: "Use a deeper prompt when you want structured reasoning.",
    prompt: "Think step by step about this:\n\n",
    example: "Example: think step by step about the safest way to add a new tool route.",
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
          ? "This Docker board has no local Qwen. Pick Nano, Lightning, or Super and try one of these English examples to explore the board."
          : "Light work stays on the Jetson. Heavy reasoning goes to Nebius, compressed first. Every chat here reads this device's memory files. Start with one of these English examples or type your own prompt."}
      </p>
      <ul className={styles.starters}>
        {starters.map((s) => (
          <li key={s.label}>
            <button type="button" onClick={() => onPick(s.prompt)}>
              <span className={styles.starterBody}>
                <strong>{s.label}</strong>
                <small>{s.hint}</small>
                <em>{s.example}</em>
              </span>
              <span aria-hidden className={styles.starterArrow}>→</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
