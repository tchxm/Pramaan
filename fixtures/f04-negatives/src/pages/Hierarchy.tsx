// Accept/reject pair that differs only in visual hierarchy (size/weight).
// Color and opacity are equal, so S4 alone cannot flag this as confirm-shaming
// or interface interference.
export default function Hierarchy() {
  return (
    <div>
      <button className="cta-yes" type="button">Yes, continue</button>
      <button className="decline" type="button">No, go back</button>
    </div>
  );
}
