import styles from "./Panel.module.css";

type Segment = { value: number; color: string; label: string };

type Props = {
  segments: Segment[];
  total: number;
  label: string;
};

export function Meter({ segments, total, label }: Props) {
  return (
    <div className={styles.meter} role="img" aria-label={label}>
      {segments.map((s) => (
        <span
          key={s.label}
          title={s.label}
          style={{ width: `${total ? Math.min(100, (s.value / total) * 100) : 0}%`, background: s.color }}
        />
      ))}
    </div>
  );
}
