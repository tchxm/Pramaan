import { useState } from "react";

// Pre-checked "Remember me": consent/utility exclusion, not basket sneaking.
export default function RememberMe() {
  const [remember, setRemember] = useState(true);
  return (
    <label>
      <input
        type="checkbox"
        checked={remember}
        onChange={(e) => setRemember(e.target.checked)}
      />
      {" "}Remember me
    </label>
  );
}
