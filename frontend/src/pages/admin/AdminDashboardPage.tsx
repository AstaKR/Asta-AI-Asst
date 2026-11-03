import { useEffect, useState } from "react";

import { ApiError, adminApi } from "../../api";
import { CostChart } from "../../components/admin/CostChart";
import { Meter, StatTile } from "../../components/admin/Stats";
import { ErrorBanner, Layout, PageHeader } from "../../components/Layout";
import type { AdminOverview } from "../../types";

const RANGES = [7, 14, 30];
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

export function AdminDashboardPage() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    adminApi
      .overview(days)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Could not load the dashboard"));
    return () => {
      alive = false;
    };
  }, [days]);

  const today = data?.days[data.days.length - 1];
  const sum = (k: "calls" | "meetings" | "assistant_requests" | "quick_translations") => data?.days.reduce((a, d) => a + d[k], 0) ?? 0;

  return (
    <Layout wide>
      <PageHeader
        eyebrow="Admin"
        title="Dashboard"
        description="Usage, limits and estimated provider cost across the whole service."
        actions={
          <div className="flex rounded-xl border border-line bg-surface p-1" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                aria-pressed={days === r}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${days === r ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"}`}
              >
                {r} days
              </button>
            ))}
          </div>
        }
      />
      {error && <ErrorBanner message={error} />}
      {!data ? (
        !error && <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label={`Estimated cost · ${days} days`} value={inr(data.period_cost_inr)} hint={`Today ${inr(today?.cost_inr.total ?? 0)}`} />
            <StatTile label="Active calls now" value={data.today.active_calls} hint={`${sum("calls")} calls in ${days} days`} />
            <StatTile label="Users" value={data.today.users_total.toLocaleString("en-IN")} hint={`${data.days.reduce((a, d) => a + d.new_users, 0)} new in ${days} days`} />
            <StatTile label={`Meetings · ${days} days`} value={sum("meetings")} hint={`${sum("assistant_requests")} assistant · ${sum("quick_translations")} instant`} />
          </div>

          <CostChart days={data.days} />

          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <section className="card p-5">
              <h2 className="font-semibold text-ink">Today's AI budget</h2>
              <p className="mb-5 text-xs text-muted">Service-wide daily limits (DAILY_*_LIMIT in .env). AI stops for everyone when one is reached.</p>
              <div className="grid gap-5 sm:grid-cols-2">
                <Meter label="Call time" used={data.today.usage.call_seconds / 60} limit={data.today.limits.call_seconds / 60} unit="min" />
                <Meter label="Speech recognition" used={data.today.usage.stt_seconds / 60} limit={data.today.limits.stt_seconds / 60} unit="min" />
                <Meter label="Translation" used={data.today.usage.translate_chars} limit={data.today.limits.translate_chars} unit="chars" />
                <Meter label="AI voice" used={data.today.usage.tts_chars} limit={data.today.limits.tts_chars} unit="chars" />
              </div>
            </section>
            <section className="card p-5">
              <h2 className="mb-3 font-semibold text-ink">Most active today</h2>
              {data.top_users.length === 0 ? (
                <p className="text-sm text-muted">No activity yet today.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.top_users.map((u) => (
                    <li key={u.id} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="truncate font-medium text-ink">{u.name}</span>
                      <span className="text-muted tabular-nums">
                        {u.calls} calls · {u.assistant} AI
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card overflow-hidden">
            <h2 className="px-5 pt-5 font-semibold text-ink">Daily activity</h2>
            <div className="overflow-x-auto p-5 pt-3">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    {["Day", "Calls", "Meetings", "Instant", "Assistant", "Phone", "New users", "Speech min"].map((h, i) => (
                      <th key={h} className={`py-2 font-medium ${i ? "text-right" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...data.days].reverse().map((d) => (
                    <tr key={d.date} className="text-ink">
                      <td className="py-2">{new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</td>
                      {[d.calls, d.meetings, d.quick_translations, d.assistant_requests, d.phone_calls, d.new_users, d.stt_minutes].map((v, i) => (
                        <td key={i} className="py-2 text-right tabular-nums">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Layout>
  );
}
