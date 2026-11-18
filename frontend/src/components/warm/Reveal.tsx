import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Fades and lifts its children in the first time they scroll into view (see [data-reveal] in warm.css). */
export function Reveal({ children, className, delay = 0, tilt = 0 }: { children: ReactNode; className?: string; delay?: number; tilt?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} data-reveal data-in={shown ? "" : undefined} className={className} style={{ "--d": `${delay}ms`, "--r": `${tilt}deg` } as CSSProperties}>
      {children}
    </div>
  );
}
