import { HERO_PROOF } from "./landingContent";
import { HeroSession } from "./HeroSession";
import styles from "./Landing.module.css";

export function LandingHero({ openHref }: { openHref: string }) {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>
          <span className={styles.pulse} aria-hidden />
          NVIDIA Jetson × Nebius Token Factory
        </p>
        <h1 id="hero-title">
          Your Jetson, with a <em>cloud brain</em> on call.
        </h1>
        <p className={styles.lead}>
          Nebius Desk turns the Jetson on your bench into a private AI workstation you can reach
          from any browser or phone. Everyday work runs on the device for free. When a question is
          genuinely hard, Desk hands it to Nemotron on Nebius and shows you exactly what it spent.
        </p>
        <div className={styles.actions}>
          <a className={styles.primaryLg} href={openHref}>
            Open your desk
            <span aria-hidden>→</span>
          </a>
          <a className={styles.ghost} href="#how">
            See how it works
          </a>
        </div>
        <dl className={styles.proof}>
          {HERO_PROOF.map((p) => (
            <div key={p.value}>
              <dt>{p.value}</dt>
              <dd>{p.label}</dd>
            </div>
          ))}
        </dl>
      </div>
      <HeroSession />
    </section>
  );
}
