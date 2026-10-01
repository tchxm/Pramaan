import { useState } from "react";

// Pre-checked Terms agreement: consent exclusion, out of scope for PRM-001.
export default function Terms() {
  const [agree, setAgree] = useState(true);
  return (
    <label>
      <input
        type="checkbox"
        checked={agree}
        onChange={(e) => setAgree(e.target.checked)}
      />
      {" "}I agree to the Terms
    </label>
  );
}
