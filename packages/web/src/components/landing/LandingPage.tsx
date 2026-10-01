import "../../styles/landing.css";
import BootGate from "./BootGate.js";
import HeroGlobe from "./HeroGlobe.js";
import TopNavigation from "./TopNavigation.js";
import HeroIntro from "./HeroIntro.js";
import HeroActions from "./HeroActions.js";

/**
 * PRAMAAN landing hero. Dark, evidence-grade editorial — serif headline,
 * mono data texture, warm gold accent — carried by typography and a
 * lightweight reactive canvas backdrop, not feature cards or dashboards.
 */
export default function LandingPage() {
  return (
    <div className="lp-page">
      <BootGate />
      <HeroGlobe />

      <TopNavigation />

      <section id="how-it-works" className="lp-hero">
        <div className="lp-hero__content">
          <HeroIntro />
          <HeroActions />
        </div>
      </section>
    </div>
  );
}
