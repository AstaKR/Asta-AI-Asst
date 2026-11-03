import type { ReactNode } from "react";

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Usage against a limit. State is carried by the label text as well as colour. */
export function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const state = pct >= 100 ? "Limit reached" : pct >= 80 ? "Almost used" : "OK";
  const bar = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-brand";
  const text = pct >= 100 ? "text-danger" : pct >= 80 ? "text-warn" : "text-muted";
  const fmt = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("en-IN") : String(Math.round(n * 10) / 10));
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-muted tabular-nums">
          {fmt(used)} / {fmt(limit)} {unit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-1 text-xs ${text}`}>
        {state} · {Math.round(pct)}%
      </p>
    </div>
  );
}
