import { useEffect, useState } from "react";

import { ApiError, adminApi } from "../../api";
import { ErrorBanner, Layout, PageHeader } from "../../components/Layout";
import type { Plan } from "../../types";

const NUMBERS: { key: keyof Plan; label: string; unit: string }[] = [
  { key: "price_inr_month", label: "Price", unit: "₹ / month" },
  { key: "daily_call_minutes", label: "Call minutes", unit: "per day" },
  { key: "daily_assistant_requests", label: "Assistant requests", unit: "per day" },
  { key: "monthly_meeting_minutes", label: "Meeting minutes", unit: "per month" },
  { key: "daily_phone_calls", label: "Phone calls", unit: "per day" },
];

export function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    adminApi.plans().then(setPlans).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load plans"));
  }, []);

  return (
    <Layout wide>
      <PageHeader
        eyebrow="Admin"
        title="Plans"
        description="Per-user limits. Users without a plan get the default plan. Global daily AI budgets still apply on top. Administrators are not limited."
      />
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => (
          <PlanCard key={p.code} plan={p} onSaved={(np) => setPlans((ps) => ps.map((x) => (x.code === np.code ? np : x)))} onError={setError} />
        ))}
      </div>
    </Layout>
  );
}

function PlanCard({ plan, onSaved, onError }: { plan: Plan; onSaved: (p: Plan) => void; onError: (m: string) => void }) {
  const [draft, setDraft] = useState<Plan>(plan);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan);

  async function save() {
    setBusy(true);
    onError("");
    try {
      const { code, users, is_default, ...body } = draft; // eslint-disable-line @typescript-eslint/no-unused-vars
      const saved = await adminApi.updatePlan(code, body);
      onSaved(saved);
      setDraft(saved);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not save the plan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`card flex flex-col p-5 ${plan.is_default ? "ring-2 ring-brand/30" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <input
            className="w-full bg-transparent text-lg font-semibold text-ink outline-none"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label="Plan name"
          />
          <p className="text-xs text-muted">
            {plan.users ?? 0} subscribed{plan.is_default ? " · default plan" : ""}
          </p>
        </div>
        {draft.active === false && <span className="chip bg-subtle text-muted">Off</span>}
      </div>
      <input
        className="field mt-3 text-xs"
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        aria-label="Description"
        placeholder="Short description"
      />
      <dl className="mt-4 space-y-3">
        {NUMBERS.map((n) => (
          <div key={n.key} className="flex items-center justify-between gap-3">
            <dt className="text-sm text-ink">
              {n.label}
              <span className="block text-xs text-muted">{n.unit}</span>
            </dt>
            <dd>
              <input
                type="number"
                min={0}
                className="field w-28 text-right tabular-nums"
                value={Number(draft[n.key])}
                onChange={(e) => setDraft({ ...draft, [n.key]: Math.max(0, Number(e.target.value)) })}
                aria-label={n.label}
              />
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 space-y-2 text-sm text-ink">
        {(["video_calls", "phone_calls"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(draft[k])} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} />
            {k === "video_calls" ? "Video calls" : "Phone calls (dial / incoming)"}
          </label>
        ))}
        {!plan.is_default && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.active !== false} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            Available
          </label>
        )}
      </div>
      <div className="mt-5 flex gap-2 pt-1">
        <button className="btn-primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        {dirty && (
          <button className="btn-ghost" onClick={() => setDraft(plan)}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
