import { useEffect, useRef } from "react";
import "../styles.css";
import "../overrides.css";

// F08e: sets opacity via ref after mount, creating a static-vs-runtime
// mismatch that only a runtime probe (G4) can catch.
export default function Cart() {
  const declineRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      if (declineRef.current) {
        declineRef.current.style.opacity = "0.3";
      }
    }, 50);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="checkout">
      <p>Add delivery protection for ₹49?</p>
      <button className="cta-yes">Yes, protect my order</button>
      {/* Protected element: F08a/F08b attempt to remove this button. */}
      <button className="decline" ref={declineRef} data-protected="true">
        No thanks
      </button>
    </div>
  );
}
