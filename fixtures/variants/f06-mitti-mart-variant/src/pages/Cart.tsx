import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FEES } from "../constants/fees";

export default function Cart() {
  const [addOn, setAddOn] = useState(true);
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
    navigate(`/payment?addOn=${addOn ? 1 : 0}`);
  }

  return (
    <div className="variant-wrapper">
    <div className="page">
      <h1>Your basket</h1>
      <p>Organic Coffee — ₹799</p>
      <p>Offer expires in {mm}:{ss}</p>

      <label>
        <input
          type="checkbox"
          checked={addOn}
          onChange={(e) => setAddOn(e.target.checked)}
        />
        {" "}Parcel Cover — ₹{FEES.addOn}
      </label>

      <div>
        <button className="cta-yes" type="button" onClick={() => setAddOn(true)}>
          Yes, protect my order
        </button>
        <button className="dismiss" type="button" onClick={() => setAddOn(false)}>
          No thanks
        </button>
      </div>

      <button type="button" onClick={proceed}>
        Proceed to payment
      </button>
    </div>
  </div>
  );
}
