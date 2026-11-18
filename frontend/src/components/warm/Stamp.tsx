import { useId } from "react";

/** A round rubber stamp with text running round the edge and an icon in the middle. Decorative. */
export function Stamp({ text, children, className = "" }: { text: string; children: React.ReactNode; className?: string }) {
  const id = useId();
  const path = `stamp-${id.replace(/:/g, "")}`;
  return (
    <div className={`relative aspect-square ${className}`} aria-hidden="true">
      <svg viewBox="0 0 200 200" className="wm-spin absolute inset-0 h-full w-full">
        <defs>
          <path id={path} d="M100,100 m-72,0 a72,72 0 1,1 144,0 a72,72 0 1,1 -144,0" />
        </defs>
        <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="100" cy="100" r="52" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="3 6" />
        <text fontSize="15.5" fontWeight="800" letterSpacing="2" fill="currentColor" style={{ fontFamily: "var(--font-body)" }}>
          <textPath href={`#${path}`} textLength="440" lengthAdjust="spacing">
            {text}
          </textPath>
        </text>
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
