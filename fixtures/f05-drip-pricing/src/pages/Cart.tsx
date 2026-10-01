import { Link } from "react-router-dom";

export default function Cart() {
  return (
    <div className="page">
      <h1>Your basket</h1>
      <p>Organic Coffee — ₹799</p>
      <Link to="/payment">
        <button type="button">Proceed to payment</button>
      </Link>
    </div>
  );
}
