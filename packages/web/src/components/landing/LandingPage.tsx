import "../../styles/landing.css";
import BootGate from "./BootGate.js";
import AppShell from "../shell/AppShell.js";
import HeroStory from "./story/HeroStory.js";
import { useEffect } from "react";
import { stopVoice } from "./voice.js";

/**
 * PRAMAAN landing page. The boot gate, shown once per session with an
 * explicit replay control, hands off into a 5-beat scroll story: IDENTIFY,
 * DETECT, INVESTIGATE, VERIFY, PROVE (spec section 14). HeroStory owns its
 * own full-viewport 3D stage; this component just sequences gate → shell →
 * story.
 */
export default function LandingPage() {
  // Breakpoint changes preserve speech; leaving the landing stops it.
  useEffect(() => () => stopVoice(), []);
  return (
    <div className="lp-page">
      <BootGate />

      <AppShell variant="transparent" />

      <HeroStory />
    </div>
  );
}
