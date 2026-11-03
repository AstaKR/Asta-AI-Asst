import { useEffect, useState } from "react";

import { ApiError, adminApi } from "../../api";
import { useAuth } from "../../auth";
import { Meter } from "../../components/admin/Stats";
import { CloseIcon } from "../../components/Icons";
import { ErrorBanner, Layout, PageHeader } from "../../components/Layout";
import type { AdminUser, Plan } from "../../types";

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [count, setCount] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    adminApi
      .users(query, page)
      .then((r) => {
        setRows(r.results);
        setCount(r.count);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load users"));
  }, [query, page]);

  useEffect(() => {
    adminApi.plans().then(setPlans).catch(() => undefined);
  }, []);

  function replace(u: AdminUser) {
    setRows((rs) => rs.map((r) => (r.id === u.id ? u : r)));
    setSelected(u);
  }

  const planName = (code: string | null) => plans.find((p) => p.code === code)?.name ?? code ?? "—";
  const pages = Math.max(1, Math.ceil(count / 25));

  return (
    <Layout wide>
      <PageHeader eyebrow="Admin" title="Users" description={`${count.toLocaleString("en-IN")} accounts. Change plans or deactivate accounts (signs them out of the app).`} />
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <input className="field mb-4 max-w-md" placeholder="Search name, username or phone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Phone</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Joined</th>
              <th className="px-5 py-3 font-medium">Last sign-in</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((u) => (
              <tr key={u.id} className="cursor-pointer text-ink hover:bg-subtle" onClick={() => adminApi.user(u.id).then(setSelected).catch(() => setSelected(u))}>
                <td className="px-5 py-3">
                  <p className="font-medium">{u.name}</p>
                  {u.is_staff && <span className="chip mt-1 bg-brand-soft text-brand">Admin</span>}
                </td>
                <td className="px-5 py-3 tabular-nums text-muted">{u.phone ?? "—"}</td>
                <td className="px-5 py-3">{planName(u.plan)}</td>
                <td className="px-5 py-3 text-muted">{new Date(u.date_joined).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-muted">{u.last_login ? new Date(u.last_login).toLocaleDateString() : "Never"}</td>
                <td className="px-5 py-3">
                  <span className={`chip ${u.is_active ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"}`}>{u.is_active ? "Active" : "Deactivated"}</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          <button className="btn-secondary px-3 py-1.5" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}

      {selected && <UserPanel user={selected} plans={plans} isMe={selected.id === me?.id} onClose={() => setSelected(null)} onSaved={replace} onError={setError} />}
    </Layout>
  );
}

function UserPanel(props: { user: AdminUser; plans: Plan[]; isMe: boolean; onClose: () => void; onSaved: (u: AdminUser) => void; onError: (m: string) => void }) {
  const { user, plans } = props;
  const [plan, setPlan] = useState(user.plan ?? "");
  const [busy, setBusy] = useState(false);
  const current = plans.find((p) => p.code === user.plan);

  async function save(body: { plan?: string; is_active?: boolean }) {
    setBusy(true);
    try {
      props.onSaved(await adminApi.updateUser(user.id, body));
    } catch (err) {
      props.onError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`User ${user.name}`}>
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={props.onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col gap-6 overflow-y-auto border-l border-line bg-surface p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">{user.name}</h2>
            <p className="text-sm text-muted">
              {user.phone ?? user.username} · joined {new Date(user.date_joined).toLocaleDateString()}
            </p>
          </div>
          <button className="btn-ghost h-9 w-9 p-0" onClick={props.onClose} aria-label="Close">
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        {user.usage && current && (
          <section className="space-y-4">
            <p className="eyebrow">Usage on {current.name}</p>
            <Meter label="Call minutes today" used={user.usage.call_minutes_today} limit={current.daily_call_minutes} unit="min" />
            <Meter label="Assistant today" used={user.usage.assistant_requests_today} limit={current.daily_assistant_requests} unit="requests" />
            <Meter label="Meetings this month" used={user.usage.meeting_minutes_this_month} limit={current.monthly_meeting_minutes} unit="min" />
          </section>
        )}

        <section>
          <label className="label" htmlFor="plan">
            Plan
          </label>
          <div className="flex gap-2">
            <select id="plan" className="field" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans
                .filter((p) => p.active !== false)
                .map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — ₹{p.price_inr_month}/month
                  </option>
                ))}
            </select>
            <button className="btn-primary" disabled={busy || plan === user.plan} onClick={() => void save({ plan })}>
              Save
            </button>
          </div>
          <p className="mt-1.5 text-xs text-muted">Payments are not connected yet — plan changes are manual.</p>
        </section>

        <section className="mt-auto border-t border-line pt-5">
          {user.is_active ? (
            <button
              className="btn-secondary w-full text-danger"
              disabled={busy || props.isMe}
              onClick={() => window.confirm(`Deactivate ${user.name}? They are signed out and cannot sign in.`) && void save({ is_active: false })}
            >
              Deactivate account
            </button>
          ) : (
            <button className="btn-secondary w-full" disabled={busy} onClick={() => void save({ is_active: true })}>
              Reactivate account
            </button>
          )}
          {props.isMe && <p className="mt-2 text-center text-xs text-muted">You cannot deactivate yourself.</p>}
        </section>
      </aside>
    </div>
  );
}
