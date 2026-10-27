import { BrandMark } from "@/ui/BrandMark";
import styles from "./Landing.module.css";

const SURFACES = [
  ["Desk", "Chat with the Jetson. Light turns stay on the device."],
  ["CLI", "A shell on the machine, from the web desk and the phone."],
  ["Files", "Read, create, and edit files on the Jetson."],
  ["Health", "Temperature, CPU, GPU, RAM, and disk, read from the box after you sign in."],
] as const;

const RULES = [
  ["On the Jetson", "Summaries, memory, and private work. Not billed."],
  ["On Nebius", "Hard reasoning. Spends the credit balance on the plan."],
  ["On Tavily", "Web search. One credit per basic search."],
] as const;

const INCLUDED = [
  ["Remote desk, CLI, and files", "Unlimited"],
  ["Local models and health", "Unlimited"],
  ["Nebius credits", "$3"],
  ["Tavily search", "500"],
] as const;

const STEPS = [
  ["Install", "The Desk agent goes on the Jetson. That box is the computer."],
  ["Sign in", "The phone and the browser open the same session."],
  ["Work", "Chat, shell, and files reach the machine. Nebius is only for the hard turn."],
] as const;

export function Landing({ openHref }: { openHref: string }) {
  return (
    <main className={styles.page}>
      <header className={styles.bar}>
        <a className={styles.brand} href="/">
          <BrandMark size={22} />
          Nebius<b>Desk</b>
        </a>
        <nav className={styles.nav} aria-label="Page">
          <a href="#included">Included</a>
          <a href="#plan">Plan</a>
          <a className={styles.primary} href={openHref}>
            Open the desk
          </a>
        </nav>
      </header>

      <div className={styles.frame}>
        <section className={styles.hero}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Public introduction</p>
            <h1>A private desk for your Jetson.</h1>
            <p className={styles.lead}>
              Nebius Desk is a subscription. You install an agent on the Jetson, then sign in from
              the web or the phone. The session is the remote desk for that machine. This page does
              not connect to a device and does not show live readings.
            </p>
            <div className={styles.actions}>
              <a className={styles.primary} href={openHref}>
                Open the desk
              </a>
              <a className={styles.quiet} href="#plan">
                Read the plan
              </a>
            </div>
          </div>
          <ul className={styles.surfaces} aria-label="What the signed-in desk includes">
            {SURFACES.map(([title, text]) => (
              <li key={title}>
                <h2>{title}</h2>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.rules} id="included" aria-labelledby="where">
          <h2 id="where">Where a message goes</h2>
          <ul>
            {RULES.map(([title, text]) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.plan} id="plan">
          <div className={styles["plan-copy"]}>
            <p className={styles.eyebrow}>Desk plan</p>
            <h2>One price for the Jetson. Credits for the cloud.</h2>
            <p>
              Remote access and local processing are part of the subscription. Nebius and Tavily
              are a balance. When that balance is gone, the desk still answers on the Jetson.
            </p>
          </div>
          <dl className={styles.included}>
            {INCLUDED.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={styles.steps} aria-labelledby="start">
          <h2 id="start">Start</h2>
          <ol>
            {STEPS.map(([title, text], index) => (
              <li key={title}>
                <span className={styles["step-index"]}>{index + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
