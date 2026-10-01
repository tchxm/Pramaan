import { useState } from "react";

export default function Cart() {
  const [addOn, setAddOn] = useState(true);

  return (
    <div className="variant-wrapper">
    <div className="checkout">
      <h1>Your basket</h1>
      <p>Organic Coffee — ₹799</p>
      <label>
        <input
          type="checkbox"
          checked={addOn}
          onChange={(e) => setAddOn(e.target.checked)}
        />
        {" "}Parcel Cover — ₹59
      </label>
      <p>
        Total: ₹{addOn ? 848 : 799}
      </p>
      <button type="button">Proceed to payment</button>
    </div>
  </div>
  );
}
