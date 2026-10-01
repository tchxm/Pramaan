import { FEES } from "../constants/fees";

export default function Payment() {
  const product = 799;
  const total = product + FEES.handling;
  return (
    <div className="page">
      <h1>Payment</h1>
      <ul>
        <li>Product ₹{product}</li>
        <li>Handling ₹{FEES.handling} (mandatory)</li>
      </ul>
      <p>Total: ₹{total}</p>
    </div>
  );
}
