import { useEffect, useRef } from "react";
import { gsap } from "gsap";

// The one deliberate GSAP use in this app: tweening a real number upward as the
// backend's own evidence count grows communicates "this is live," which a static
// number cannot. Not used anywhere the value doesn't actually change over time.
export function LiveCounter({ value, label }) {
  const ref = useRef(null);
  const prev = useRef(value);

  useEffect(() => {
    if (!ref.current) return;
    const from = prev.current;
    const obj = { n: from };
    gsap.to(obj, {
      n: value,
      duration: 0.6,
      ease: "power2.out",
      onUpdate: () => {
        if (ref.current) ref.current.textContent = Math.round(obj.n);
      },
    });
    prev.current = value;
  }, [value]);

  // Demoted to metadata weight (sreoncall-ui law 1): these are context, not the thing that
  // needs a decision. Number and label sit on one baseline so four of them read as a single
  // quiet strip rather than four competing stat tiles.
  return (
    <div className="flex items-baseline gap-1.5">
      <span ref={ref} className="t-label font-mono text-muted-text">{value}</span>
      <span className="t-micro text-muted-text-2">{label}</span>
    </div>
  );
}
