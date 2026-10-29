import { BrandMark } from "@/ui/BrandMark";
import styles from "./Landing.module.css";

export function LandingFooter({ openHref }: { openHref: string }) {
  return (
    <>
      <section className={styles.cta} aria-labelledby="cta-title">
        <h2 id="cta-title">Your Jetson is ready when you are.</h2>
        <p>Sign in and the whole machine is one tab away.</p>
        <a className={styles.primaryLg} href={openHref}>
          Open your desk
          <span aria-hidden>→</span>
        </a>
      </section>
      <footer className={styles.footer}>
        <span className={styles.brand}>
          <BrandMark size={18} />
          <span>
            Nebius<b>Desk</b>
          </span>
        </span>
        <span>Built for NVIDIA Jetson · Reasoning by Nebius Token Factory · Search by Tavily</span>
      </footer>
    </>
  );
}
