import { useEffect, useState } from "react";
import "../../styles/checkout.css";

export function protectionDefault(source: string): boolean | undefined {
  const match = source.match(/\[protection,\s*setProtection\]\s*=\s*useState\((true|false)\)/);
  return match ? match[1] === "true" : undefined;
}

/** A deliberately limited illustration of Mitti Mart, driven by source state.
 * It does not execute project code or stand in for browser verification. */
export default function CheckoutPreview({ original, patched, verified = false, paired = false }: {
  original: boolean; patched?: boolean; verified?: boolean; paired?: boolean;
}) {
  const [view, setView] = useState<"original" | "patched">("original");
  const [originalChoice, setOriginalChoice] = useState(original);
  const [patchedChoice, setPatchedChoice] = useState(patched ?? false);
  useEffect(() => { setOriginalChoice(original); setPatchedChoice(patched ?? false); }, [original, patched]);
  const card = (after: boolean) => {
    const selected = after ? patchedChoice : originalChoice;
    return <div className={`checkout-card ${after ? "checkout-card--patched" : ""}`} data-testid={after ? "checkout-patched" : "checkout-original"}>
      <div className="checkout-card__head"><span>{after ? "Patched source" : "Original source"}</span><span>{after ? "CHOICE RESTORED" : "BEFORE THE FIX"}</span></div>
      <h3>Mitti Mart <span>/ your basket</span></h3>
      <div className="checkout-product"><span className="checkout-product__art" aria-hidden="true">◉</span><div><strong>Organic coffee</strong><small>One bag · sample checkout</small></div><b>₹799</b></div>
      <div className="checkout-urgency">Offer expires in 02:00 <small>Resetting countdown · still unresolved</small></div>
      <label className="checkout-option"><input type="checkbox" checked={selected} onChange={e => after ? setPatchedChoice(e.target.checked) : setOriginalChoice(e.target.checked)} /><span>Delivery Protection<small>{after ? "Starts unchecked. Add it only if you want it." : "Starts checked before the shopper chooses."}</small></span><b>₹49</b></label>
      <dl className="checkout-total"><div><dt>Basket subtotal</dt><dd>₹{799 + (selected ? 49 : 0)}</dd></div><div><dt>Fee revealed at payment</dt><dd>+ ₹39</dd></div><div><dt>Payment total</dt><dd data-testid={after ? "patched-total" : "original-total"}>₹{838 + (selected ? 49 : 0)}</dd></div></dl>
      <p className="checkout-card__note">{after ? "The checkbox fix restores this choice. The countdown, unequal controls and late fee still need review." : "The advertised ₹799 becomes ₹887 when the preselected extra and later fee are included."}</p>
    </div>;
  };
  return <section className="checkout-preview" aria-label="Checkout preview">
    <div className="checkout-preview__intro"><p className="checkout-eyebrow">THE SHOPPER SEES THE DIFFERENCE</p><h2>A small code change.<br />A real choice restored.</h2><p>The agent proposes. The independent engine checks. This illustration uses the recorded checkbox default; verification comes from the actual gates.</p></div>
    {!paired && <div className="checkout-switch" role="group" aria-label="Checkout version"><button aria-pressed={view === "original"} onClick={() => setView("original")}>Original</button><button disabled={patched === undefined} aria-pressed={view === "patched"} onClick={() => setView("patched")}>Patched</button></div>}
    <div className="checkout-impact" aria-label="Initial checkout totals"><span>Original default <b>₹{838 + (original ? 49 : 0)}</b></span><span aria-hidden="true">→</span><span>{patched === undefined ? "Patched default pending" : <>Patched default <b>₹{838 + (patched ? 49 : 0)}</b></>}</span><small>Payment total including the unresolved ₹39 fee. Protection remains available by choice.</small></div>
    <div className={paired ? "checkout-pair" : "checkout-single"}>{paired ? <>{card(false)}{patched !== undefined ? card(true) : <p>The patched source is not available yet.</p>}</> : view === "patched" && patched !== undefined ? card(true) : card(false)}</div>
    <div className="checkout-proof"><span>{verified ? "✓ Engine verdict: VERIFIED" : patched !== undefined ? "Patch available · see engine checks for its verdict" : "Original source · waiting for an applied patch"}</span><button onClick={() => { setOriginalChoice(original); setPatchedChoice(patched ?? false); }}>Reset shopper choices</button></div>
  </section>;
}
