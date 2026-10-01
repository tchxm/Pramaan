// SpeechSynthesis cannot expose its waveform to Web Audio. This is explicitly
// a PROCEDURAL SPEECH ENVELOPE FALLBACK, driven by actual speech lifecycle events.
// No microphone, fabricated analyser bins, or network audio requests.
export const voiceVisual = { speaking: false, amplitude: 0 };
let onset = 0;
let pulse = 0;
let utterance: SpeechSynthesisUtterance | null = null;

export function sampleVoice(now: number, dt: number) {
  const elapsed = (now - onset) / 1000;
  const target = voiceVisual.speaking
    ? Math.min(1, 0.25 + Math.max(0, Math.sin(elapsed * 13)) * 0.35 + Math.exp(-(now - pulse) / 170) * 0.35)
    : 0;
  voiceVisual.amplitude += (target - voiceVisual.amplitude) * (1 - Math.exp(-dt * 12));
  return voiceVisual.amplitude;
}

export function stopVoice() {
  if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
  utterance = null;
  voiceVisual.speaking = false;
}

export function activateVoice(onFailure?: () => void): boolean {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return false;
  try {
    try { if (sessionStorage.getItem("pramaan:voice-intro") === "1") return true; } catch { /* speech still works without storage */ }
    utterance = new SpeechSynthesisUtterance("PRAMAAN online. Audit engine ready.");
    utterance.rate = 0.9;
    utterance.onstart = () => {
      voiceVisual.speaking = true;
      onset = pulse = performance.now();
      try { sessionStorage.setItem("pramaan:voice-intro", "1"); } catch { /* optional persistence */ }
    };
    utterance.onboundary = () => { pulse = performance.now(); };
    utterance.onend = () => { voiceVisual.speaking = false; };
    utterance.onerror = () => { voiceVisual.speaking = false; onFailure?.(); };
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    voiceVisual.speaking = false;
    return false;
  }
}
