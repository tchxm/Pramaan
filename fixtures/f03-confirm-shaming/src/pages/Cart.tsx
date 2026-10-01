export default function Cart() {
  return (
    <div className="checkout">
      <h1>Your basket</h1>
      <p>Organic Coffee — ₹799</p>
      <p>Add delivery protection for ₹49?</p>
      <button className="cta-yes" type="button">Yes, add protection</button>
      <button className="decline" type="button">
        No thanks, I prefer paying full price.
      </button>
    </div>
  );
}
