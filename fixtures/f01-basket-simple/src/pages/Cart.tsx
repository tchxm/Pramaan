import { useState } from "react";

export default function Cart() {
  const [protection, setProtection] = useState(true);

  return (
    <div className="checkout">
      <h1>Your basket</h1>
      <p>Organic Coffee — ₹799</p>
      <label>
        <input
          type="checkbox"
          checked={protection}
          onChange={(e) => setProtection(e.target.checked)}
        />
        {" "}Delivery Protection — ₹49
      </label>
      <p>
        Total: ₹{protection ? 848 : 799}
      </p>
      <button type="button">Proceed to payment</button>
    </div>
  );
}
