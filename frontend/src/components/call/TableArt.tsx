import { NATIVE_NAMES } from "../../lib/languages";

export function scriptFont(code?: string): string {
  return code?.startsWith("ta") ? "wm-tamil" : code?.startsWith("hi") ? "wm-deva" : "font-display italic";
}

interface Seat {
  name: string;
  /** Language code such as ta-IN; shown in its own script under the name. */
  lang?: string;
}

function SeatView({ seat, side, tone }: { seat?: Seat; side: "left" | "right"; tone: string }) {
  const empty = !seat;
  const first = seat?.name.split(" ")[0] ?? "";
  return (
    <>
      <span
        className={`absolute top-1/2 grid h-[var(--seat)] w-[var(--seat)] -translate-y-1/2 place-items-center rounded-full border-[2.5px] text-[1.7rem] font-extrabold sm:text-[2.1rem] ${
          empty ? "border-dashed border-edge text-muted" : `border-edge text-[#1c1712] shadow-[3px_3px_0_var(--color-shadow)] ${tone}`
        }`}
        style={{ [side]: "1.5%", fontFamily: "var(--font-display)" }}
      >
        {empty ? "?" : first.slice(0, 1).toUpperCase()}
      </span>
      <div className="absolute top-[calc(50%+var(--seat)/2+0.5rem)] flex w-[24%] flex-col items-center gap-1 text-center" style={{ [side]: "-1%" }}>
        <span className="max-w-full truncate text-[0.85rem] leading-tight font-bold">{empty ? <span className="wm-hand font-normal text-muted">your guest</span> : first}</span>
        {seat?.lang && (
          <span key={seat.lang} className={`wm-pop sticker !py-0 text-[0.95rem] ${scriptFont(seat.lang)}`}>
            {NATIVE_NAMES[seat.lang] ?? seat.lang}
          </span>
        )}
      </div>
    </>
  );
}

/** A table seen from above with two seats. Fills in as the people are known. Decorative. */
export function TableArt({ left, right, className = "" }: { left?: Seat; right?: Seat; className?: string }) {
  return (
    <div className={`relative mx-auto aspect-[400/215] w-full max-w-[30rem] [--seat:3.6rem] sm:[--seat:4.4rem] ${className}`} aria-hidden="true">
      <svg viewBox="0 0 400 215" className="absolute inset-0 h-full w-full">
        <ellipse cx="206" cy="90" rx="112" ry="52" fill="var(--color-edge)" />
        <ellipse cx="200" cy="84" rx="112" ry="52" fill="#f5a623" stroke="var(--color-edge)" strokeWidth="3" />
        <ellipse cx="200" cy="84" rx="88" ry="36" fill="none" stroke="var(--color-edge)" strokeWidth="1.6" strokeDasharray="1 7" strokeLinecap="round" />
        {/* two glasses of chai */}
        <circle cx="172" cy="84" r="9" fill="#fffaf0" stroke="var(--color-edge)" strokeWidth="2.5" />
        <circle cx="228" cy="84" r="9" fill="#fffaf0" stroke="var(--color-edge)" strokeWidth="2.5" />
        <path className="wm-bob" d="M172 68c-3-5 3-7 0-12M228 68c-3-5 3-7 0-12" fill="none" stroke="var(--color-edge)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0" style={{ top: "-2%" }}>
        <SeatView seat={left} side="left" tone="bg-butter" />
        <SeatView seat={right} side="right" tone="bg-mist" />
      </div>
    </div>
  );
}
