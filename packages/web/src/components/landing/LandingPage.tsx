import "../../styles/landing.css";
import BootGate from "./BootGate.js";
import AppShell from "../shell/AppShell.js";
import HeroStory from "./story/HeroStory.js";

/**
 * PRAMAAN landing page. The boot gate (unchanged — one real ceremony,
 * shown once per session) hands off into a 5-beat scroll story: IDENTIFY,
 * DETECT, INVESTIGATE, VERIFY, PROVE (spec section 14). HeroStory owns its
 * own full-viewport 3D stage; this component just sequences gate → shell →
 * story.
 */
export default function LandingPage() {
  return (
    <div className="lp-page">
      <BootGate />

      <AppShell variant="transparent" />

      <HeroStory />
    </div>
  );
}
