import { LANES, TRUST } from "./landingContent";
import styles from "./Landing.module.css";

export function RoutingSection() {
  return (
    <section className={styles.section} id="how" aria-labelledby="how-title">
      <header className={styles.sectionHead}>
        <p className={styles.eyebrow}>Smart routing</p>
        <h2 id="how-title">Every message takes the cheapest path that works.</h2>
        <p className={styles.sectionLead}>
          Desk reads each request and decides where it should run. You see the route and the cost on
          every reply, so nothing is a surprise.
        </p>
      </header>
      <ol className={styles.lanes}>
        {LANES.map((lane) => (
          <li key={lane.where} data-route={lane.route}>
            <div className={styles.laneTop}>
              <span className={styles.laneWhere}>
                <span className={styles.laneDot} aria-hidden />
                {lane.where}
              </span>
              <span className={styles.laneTag}>{lane.tag}</span>
            </div>
            <h3>{lane.title}</h3>
            <p>{lane.text}</p>
          </li>
        ))}
      </ol>
      <p className={styles.note}>Out of credits? The desk keeps answering on the Jetson.</p>

      <ul className={styles.trust} aria-label="Privacy and control">
        {TRUST.map((t) => (
          <li key={t.title}>
            <h3>{t.title}</h3>
            <p>{t.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
