import { IconCheck } from "@/ui/icons";
import styles from "./ChatList.module.css";

/** Themed checkbox visual; pair it with a real input or role="checkbox" for semantics. */
export function CheckMark({ state }: { state: "on" | "off" | "mixed" }) {
  return (
    <span className={styles.checkBox} data-state={state} aria-hidden>
      {state === "on" ? <IconCheck size={11} strokeWidth={3} /> : null}
      {state === "mixed" ? <i /> : null}
    </span>
  );
}
