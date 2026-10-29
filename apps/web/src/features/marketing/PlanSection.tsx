import { INCLUDED, STEPS } from "./landingContent";
import styles from "./Landing.module.css";

export function PlanSection() {
  return (
    <section className={styles.section} id="plan" aria-labelledby="plan-title">
      <div className={styles.plan}>
        <header className={styles.sectionHead}>
          <p className={styles.eyebrow}>Desk plan</p>
          <h2 id="plan-title">One subscription for the box. A cloud balance for the hard stuff.</h2>
          <p className={styles.sectionLead}>
            Remote access and everything that runs on the Jetson are part of the plan. Nebius and
            Tavily draw from a balance, and when it runs out the desk keeps working locally.
          </p>
        </header>
        <dl className={styles.included}>
          {INCLUDED.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ol className={styles.steps} aria-label="Getting started">
        {STEPS.map(([title, text], index) => (
          <li key={title}>
            <span className={styles.stepIndex}>{index + 1}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
