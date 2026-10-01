import "../styles.css";
import "../overrides.css";
export default function Cart() {
  return (
    <div className="checkout">
      <p>Add delivery protection for ₹49?</p>
      <button className="cta-yes">Yes, protect my order</button>
      <button className="decline">No thanks</button>
    </div>
  );
}
