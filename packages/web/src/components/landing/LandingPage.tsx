import "../../styles/landing.css";
import InteractiveVideoBackdrop from "./InteractiveVideoBackdrop.js";
import TopNavigation from "./TopNavigation.js";
import HeroIntro from "./HeroIntro.js";
import HeroActions from "./HeroActions.js";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_041744_63efcd78-bf7d-4039-99e2-2461e8a61903.mp4";

/**
 * Cinematic PRAMAAN landing hero (spec Section 9). Video + typography +
 * interaction carry the first screen deliberately — no feature cards,
 * dashboards, badge clouds, gradients, particles, or glassmorphism.
 */
export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      <InteractiveVideoBackdrop src={VIDEO_SRC} />

      <TopNavigation />

      <section
        id="how-it-works"
        className="relative z-10 flex min-h-screen flex-col justify-end px-5 pb-12 sm:px-8 md:justify-center md:pb-0"
      >
        <div className="max-w-xl">
          <HeroIntro />
          <HeroActions />
        </div>
      </section>
    </div>
  );
}
