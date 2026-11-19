import type { ReactNode } from "react";

export interface Seat {
  name: string;
  color: string; // any CSS color
  words: number;
  active: boolean;
}

// Theme tokens, so seat colours stay readable on both the paper and the night theme.
export const SEAT_COLORS = ["var(--color-brand)", "var(--color-accent)", "var(--color-neon)", "var(--color-pink)", "var(--color-warn)", "var(--color-danger)"];

const initials = (name: string) =>
  name
    .replace(/^speaker\s*/i, "")
    .trim()
    .slice(0, 2)
    .toUpperCase() || "?";

/**
 * "Round table": the mic sun in the middle of a printed table, and each detected speaker seated around it. A new
 * speaker pops in; the one who spoke last lifts off the page with a rippling ring. Seats are placed on an ellipse,
 * starting at the top and going clockwise.
 */
export function RoundTable({ seats, children }: { seats: Seat[]; children: ReactNode }) {
  const n = Math.max(seats.length, 1);
  return (
    <div className="relative mx-auto aspect-[1.35/1] w-full max-w-[560px]">
      <div className="absolute inset-[16%] rounded-[50%] border-[2.5px] border-edge bg-butter shadow-[5px_5px_0_var(--color-shadow)]" aria-hidden="true" />
      <div className="absolute inset-[22%] rounded-[50%] border-2 border-dashed border-[#1c1712]/40" aria-hidden="true" />
      <div className="absolute inset-[24%] grid place-items-center">{children}</div>
      {seats.map((s, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const left = 50 + Math.cos(angle) * 42;
        const top = 50 + Math.sin(angle) * 40;
        return (
          <div
            key={s.name}
            className="animate-pop absolute flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"
            style={{ left: `${left}%`, top: `${top}%` }}
            aria-label={`${s.name}${s.active ? ", spoke last" : ""}`}
          >
            <span className="relative grid h-12 w-12 place-items-center">
              {s.active && <span className="animate-seat-ring absolute inset-0 rounded-full" style={{ color: s.color }} />}
              <span
                className="relative grid h-12 w-12 place-items-center rounded-full border-[2.5px] border-edge text-sm font-extrabold text-ink transition-all duration-500"
                style={{
                  background: `color-mix(in srgb, ${s.color} ${s.active ? 60 : 28}%, var(--color-surface))`,
                  boxShadow: s.active ? `4px 4px 0 ${s.color}` : "2px 2px 0 var(--color-shadow)",
                  transform: s.active ? "translate(-2px,-2px) scale(1.1)" : "none",
                  fontFamily: "var(--font-display)",
                }}
              >
                {initials(s.name)}
              </span>
            </span>
            <span className="mt-2.5 max-w-full truncate text-[0.72rem] font-bold text-ink">{s.name}</span>
            <span className="font-mono text-[0.65rem] text-muted">{s.words} words</span>
          </div>
        );
      })}
    </div>
  );
}
