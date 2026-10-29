import { SESSION } from "./landingContent";
import styles from "./HeroSession.module.css";

/** Static, illustrative desk session — rows reveal in sequence via CSS. */
export function HeroSession() {
  return (
    <figure className={styles.window}>
      <div className={styles.chrome}>
        <span className={styles.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.title}>desk · jetson-orin-nano</span>
        <span className={styles.status}>
          <span className={styles.live} aria-hidden />
          online
        </span>
      </div>
      <ol className={styles.thread} aria-label="Example conversation">
        {SESSION.map((turn, i) => (
          <li key={turn.ask} className={styles.turn} style={{ animationDelay: `${0.25 + i * 0.9}s` }}>
            <p className={styles.ask}>{turn.ask}</p>
            <div className={styles.answer} data-route={turn.route}>
              <span className={styles.chip}>
                <span className={styles.chipDot} aria-hidden />
                {turn.where}
                <span className={styles.chipMeta}>{turn.meta}</span>
              </span>
              <p>{turn.reply}</p>
            </div>
          </li>
        ))}
      </ol>
      <figcaption className={styles.caption}>Example session · illustrative values</figcaption>
    </figure>
  );
}
