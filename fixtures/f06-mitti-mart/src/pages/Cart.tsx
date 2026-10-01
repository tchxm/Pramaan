import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FEES } from "../constants/fees";

export default function Cart() {
  const [protection, setProtection] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const navigate = useNavigate();

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  function proceed() {
    navigate(`/payment?protection=${protection ? 1 : 0}`);
  }

  return (
    <div className="page">
      <h1>Your basket</h1>
      <p>Organic Coffee — ₹799</p>
      <p>Offer expires in {mm}:{ss}</p>

      <label>
        <input
          type="checkbox"
          checked={protection}
          onChange={(e) => setProtection(e.target.checked)}
        />
        {" "}Delivery Protection — ₹{FEES.protection}
      </label>

      <div>
        <button className="cta-yes" type="button" onClick={() => setProtection(true)}>
          Yes, protect my order
        </button>
        <button className="decline" type="button" onClick={() => setProtection(false)}>
          No thanks
        </button>
      </div>

      <button type="button" onClick={proceed}>
        Proceed to payment
      </button>
    </div>
  );
}
