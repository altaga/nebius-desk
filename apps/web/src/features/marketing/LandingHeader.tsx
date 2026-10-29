import { BrandMark } from "@/ui/BrandMark";
import styles from "./Landing.module.css";

export function LandingHeader({ openHref }: { openHref: string }) {
  return (
    <header className={styles.bar}>
      <div className={styles.barInner}>
        <a className={styles.brand} href="/" aria-label="Nebius Desk home">
          <BrandMark size={24} />
          <span>
            Nebius<b>Desk</b>
          </span>
        </a>
        <nav className={styles.nav} aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#millie">Millie</a>
          <a href="#plan">Plan</a>
        </nav>
        <a className={styles.primary} href={openHref}>
          Sign in
        </a>
      </div>
    </header>
  );
}
