export default function Cart() {
  // Literal checked={true}: no useState binding, exercises WIRE_CONTROLLED_CHECKBOX.
  return (
    <div className="checkout">
      <h1>Your basket</h1>
      <p>Organic Coffee — ₹799</p>
      <label>
        <input type="checkbox" checked={true} readOnly />
        {" "}Delivery Protection — ₹49
      </label>
      <p>Total: ₹848</p>
      <button type="button">Proceed to payment</button>
    </div>
  );
}
