import { useEffect, useState } from "react";

interface Props {
  expiresAt: number; // server-provided timestamp, not client-seeded
}

// Countdown computed from a server-backed expiry timestamp.
export default function ServerDeal({ expiresAt }: Props) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, expiresAt - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return (
    <p>
      Offer ends in {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
    </p>
  );
}
