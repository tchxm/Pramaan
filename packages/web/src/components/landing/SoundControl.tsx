import { useState } from "react";
import { activateVoice, stopVoice } from "./voice.js";

export default function SoundControl() {
  const [enabled, setEnabled] = useState(() => {
    try { return sessionStorage.getItem("pramaan:sound") === "on"; } catch { return false; }
  });
  return <button type="button" className="lp-pill story__sound" aria-pressed={enabled}
    onClick={() => {
      const next = !enabled && activateVoice(() => {
        setEnabled(false);
        try { sessionStorage.setItem("pramaan:sound", "off"); } catch { /* optional persistence */ }
      });
      if (enabled) stopVoice();
      setEnabled(next);
      try { sessionStorage.setItem("pramaan:sound", next ? "on" : "off"); } catch { /* optional persistence */ }
    }}>{enabled ? "Sound on" : "Sound off"}</button>;
}
