import { useMemo, useState } from "react";

import type { OverviewDay } from "../../types";

const SERIES = [
  { key: "sarvam", label: "Sarvam (speech + translation)", color: "var(--color-viz-1)" },
  { key: "claude", label: "Claude (assistant + photos)", color: "var(--color-viz-2)" },
] as const;

const W = 720;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 44 };

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const exp = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * exp).find((m) => m >= v) ?? 10 * exp;
}

const inr = (v: number) => `₹${v >= 100 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(v >= 10 ? 0 : 2)}`;
const dayLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Estimated provider cost per day, stacked by provider. */
export function CostChart({ days }: { days: OverviewDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = useMemo(() => niceMax(Math.max(...days.map((d) => d.cost_inr.total), 0)), [days]);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(days.length, 1);
  const barW = Math.min(28, slot * 0.6);
  const y = (v: number) => (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(days.length / 8);

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Estimated cost per day</h2>
          <p className="text-xs text-muted">From recorded usage × the rates in .env. Check against provider invoices.</p>
        </div>
        <div className="flex items-center gap-4">
          <ul className="flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setTable(!table)} aria-pressed={table}>
            {table ? "Chart" : "Table"}
          </button>
        </div>
      </div>

      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2 font-medium">Day</th>
                <th className="py-2 text-right font-medium">Sarvam</th>
                <th className="py-2 text-right font-medium">Claude</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {days.map((d) => (
                <tr key={d.date}>
                  <td className="py-2 text-ink">{dayLabel(d.date)}</td>
                  <td className="py-2 text-right tabular-nums">{inr(d.cost_inr.sarvam)}</td>
                  <td className="py-2 text-right tabular-nums">{inr(d.cost_inr.claude)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{inr(d.cost_inr.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Estimated cost per day, stacked by provider">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH - y(t)} y2={PAD.top + innerH - y(t)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={PAD.left - 8} y={PAD.top + innerH - y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">
                  {inr(t)}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = PAD.left + i * slot + (slot - barW) / 2;
              const hs = y(d.cost_inr.sarvam);
              const hc = y(d.cost_inr.claude);
              const base = PAD.top + innerH;
              const gap = hs > 0 && hc > 0 ? 2 : 0; // 2px surface gap between stacked segments
              return (
                <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
                  {/* hit target larger than the mark */}
                  <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                  {hover === i && <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="var(--color-subtle)" />}
                  {hs > 0 && <rect x={x} y={base - hs} width={barW} height={hs} rx={hc > 0 ? 0 : 4} fill={SERIES[0].color} />}
                  {hc > 0 && <rect x={x} y={base - hs - gap - hc} width={barW} height={hc} rx={4} fill={SERIES[1].color} />}
                  {i % labelEvery === 0 && (
                    <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
                      {dayLabel(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && days[hover] && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-xl border border-line bg-surface p-3 text-xs shadow-(--shadow-card)"
              style={{ left: `clamp(0px, calc(${((PAD.left + hover * slot + slot / 2) / W) * 100}% - 88px), calc(100% - 180px))` }}
            >
              <p className="mb-1.5 font-semibold text-ink">{dayLabel(days[hover].date)}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4 text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                    {s.key === "sarvam" ? "Sarvam" : "Claude"}
                  </span>
                  <span className="text-ink tabular-nums">{inr(days[hover].cost_inr[s.key])}</span>
                </p>
              ))}
              <p className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-medium text-ink">
                <span>Total</span>
                <span className="tabular-nums">{inr(days[hover].cost_inr.total)}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
