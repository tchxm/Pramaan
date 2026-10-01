import "../styles.css";
import "../overrides.css";
export default function Cart() {
  return (
    <div className="variant-wrapper">
    <div className="checkout">
      <p>Add delivery addOn for ₹59?</p>
      <button className="dismiss">No thanks</button>
      <button className="cta-yes">Yes, protect my order</button>
    </div>
  </div>
  );
}
