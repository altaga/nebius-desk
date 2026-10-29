import type { ComponentType } from "react";
import { IconBrain, IconChip, IconCode, IconFolder, IconMonitor, IconRoute } from "@/ui/icons";
import { FEATURES } from "./landingContent";
import styles from "./Landing.module.css";

const ICONS: Record<(typeof FEATURES)[number]["icon"], ComponentType<{ size?: number }>> = {
  chat: IconBrain,
  terminal: IconCode,
  files: IconFolder,
  browser: IconMonitor,
  services: IconRoute,
  health: IconChip,
};

export function FeatureGrid() {
  return (
    <section className={styles.section} id="features" aria-labelledby="features-title">
      <header className={styles.sectionHead}>
        <p className={styles.eyebrow}>The desk</p>
        <h2 id="features-title">Everything on the box, from any screen.</h2>
        <p className={styles.sectionLead}>
          Sign in once and the whole machine is within reach. No SSH keys, no port forwarding, no VPN
          to babysit.
        </p>
      </header>
      <ul className={styles.features}>
        {FEATURES.map(({ icon, title, text }) => {
          const Icon = ICONS[icon];
          return (
            <li key={title}>
              <span className={styles.featureIcon}>
                <Icon size={18} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
