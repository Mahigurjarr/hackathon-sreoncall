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

  return (
    <div className="flex flex-col">
      <span ref={ref} className="font-mono text-sm text-foreground">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-text-2">{label}</span>
    </div>
  );
}
