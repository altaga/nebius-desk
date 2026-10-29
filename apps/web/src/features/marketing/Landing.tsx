import { FeatureGrid } from "./FeatureGrid";
import { LandingFooter } from "./LandingFooter";
import { LandingHeader } from "./LandingHeader";
import { LandingHero } from "./LandingHero";
import { MillieShowcase } from "./MillieShowcase";
import { PlanSection } from "./PlanSection";
import { RoutingSection } from "./RoutingSection";
import styles from "./Landing.module.css";

export function Landing({ openHref }: { openHref: string }) {
  return (
    <div className={styles.page}>
      <LandingHeader openHref={openHref} />
      <main className={styles.frame}>
        <LandingHero openHref={openHref} />
        <FeatureGrid />
        <RoutingSection />
        <MillieShowcase />
        <PlanSection />
        <LandingFooter openHref={openHref} />
      </main>
    </div>
  );
}
