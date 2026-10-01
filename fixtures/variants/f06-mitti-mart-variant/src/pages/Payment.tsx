import { useSearchParams } from "react-router-dom";
import { FEES } from "../constants/fees";

export default function Payment() {
  const [params] = useSearchParams();
  const hasProtection = params.get("addOn") === "1";
  const product = 799;
  const total = product + FEES.handling + (hasProtection ? FEES.addOn : 0);

  return (
    <div className="page">
      <h1>Payment</h1>
      <ul>
        <li>Product ₹{product}</li>
        {hasProtection && <li>Protection ₹{FEES.addOn}</li>}
        <li>Handling ₹{FEES.handling}</li>
      </ul>
      <p>TOTAL ₹{total}</p>
    </div>
  );
}
