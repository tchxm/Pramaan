import { useEffect, useState } from "react";

// Utility timer: OTP resend cooldown, not a scarcity/urgency countdown.
export default function Otp() {
  const [seconds, setSeconds] = useState(30);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);

  return (
    <div>
      <p>Enter the OTP sent to your phone.</p>
      <button type="button" disabled={seconds > 0}>
        {seconds > 0 ? `Resend OTP in ${seconds}s` : "Resend OTP"}
      </button>
    </div>
  );
}
