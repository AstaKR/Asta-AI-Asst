import type { ReactNode } from "react";

export interface Seat {
  name: string;
  color: string; // any CSS color
  words: number;
  active: boolean;
}

export const SEAT_COLORS = ["var(--color-brand)", "var(--color-accent)", "var(--color-neon)", "var(--color-pink)", "var(--color-warn)", "var(--color-danger)"];

const initials = (name: string) =>
  name
    .replace(/^speaker\s*/i, "")
    .trim()
    .slice(0, 2)
    .toUpperCase() || "?";

/**
 * "Round table": the voice orb in the middle and each detected speaker seated around it. A new speaker pops in; the
 * one who spoke last glows and ripples. Seats are placed on an ellipse, starting at the top and going clockwise.
 */
export function RoundTable({ seats, children }: { seats: Seat[]; children: ReactNode }) {
  const n = Math.max(seats.length, 1);
  return (
    <div className="relative mx-auto aspect-[1.35/1] w-full max-w-[560px]">
      <div className="absolute inset-[12%] rounded-[50%] border border-dashed border-line" aria-hidden="true" />
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
                className="relative grid h-12 w-12 place-items-center rounded-full border text-sm font-bold text-white transition-all duration-500"
                style={{
                  borderColor: s.color,
                  background: `color-mix(in srgb, ${s.color} ${s.active ? 55 : 28}%, transparent)`,
                  boxShadow: s.active ? `0 0 26px -2px ${s.color}` : "none",
                  transform: s.active ? "scale(1.12)" : "scale(1)",
                }}
              >
                {initials(s.name)}
              </span>
            </span>
            <span className="mt-2.5 max-w-full truncate text-[11px] font-semibold text-ink">{s.name}</span>
            <span className="font-mono text-[10px] text-muted">{s.words} words</span>
          </div>
        );
      })}
    </div>
  );
}
