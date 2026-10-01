/**
 * Hero action pills. Every pill routes somewhere real via react-router's
 * useNavigate (spec Section 9.8) — none of them are dead buttons. The
 * "Watch the demo" / "See how verification works" pills use query-param
 * conventions on /audit since the audit-start screen (S1) that would
 * consume them doesn't exist yet in this pass:
 *   - ?fixture=f06-mitti-mart  -> intended to auto-select fixture F06
 *   - ?highlight=verification  -> intended to scroll/highlight the
 *     verification explanation once S1 exists
 * These are read by whoever builds S1; they're inert until then.
 */
export default function HeroActions(): import("react").JSX.Element;
