import { useEffect, useState } from "react";

import { ApiError, adminApi } from "../../api";
import { CheckIcon, KeyIcon, ShieldIcon } from "../../components/Icons";
import { ErrorBanner, Layout, PageHeader } from "../../components/Layout";
import type { KeysPayload, ProviderKeyStatus } from "../../types";

const SOURCE: Record<ProviderKeyStatus["source"], { text: string; cls: string }> = {
  admin: { text: "Set here", cls: "bg-accent-soft text-accent" },
  env: { text: "From .env", cls: "bg-brand-soft text-brand" },
  none: { text: "Not set", cls: "bg-warn-soft text-warn" },
};

export function AdminKeysPage() {
  const [data, setData] = useState<KeysPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi.keys().then(setData).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load keys"));
  }, []);

  return (
    <Layout wide>
      <PageHeader eyebrow="Admin" title="API keys" description="Provider keys used by the server. Keys are encrypted before they are stored and are never shown again — only the last 4 characters." />
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
        <ShieldIcon width={20} height={20} className="mt-0.5 shrink-0 text-accent" />
        <p>
          Only administrators can see this page. A key set here overrides the one in <code className="rounded bg-subtle px-1">.env</code>; removing it falls back to
          .env. Changes apply within 30 seconds, and every change is logged below. Never paste keys into chat or email.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.keys.map((k) => (
          <KeyCard key={k.name} status={k} onChange={setData} onError={setError} />
        ))}
      </div>

      {data && data.audit.length > 0 && (
        <section className="card mt-8 overflow-hidden">
          <h2 className="px-5 pt-5 font-semibold text-ink">Recent changes</h2>
          <div className="overflow-x-auto p-5 pt-3">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">When</th>
                  <th className="py-2 font-medium">Key</th>
                  <th className="py-2 font-medium">Action</th>
                  <th className="py-2 font-medium">By</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink">
                {data.audit.map((a, i) => (
                  <tr key={i}>
                    <td className="py-2 whitespace-nowrap text-muted">{new Date(a.at).toLocaleString()}</td>
                    <td className="py-2">{a.name.replace("_api_key", "")}</td>
                    <td className="py-2 capitalize">{a.action === "clear" ? "removed" : a.action}</td>
                    <td className="py-2">{a.user ?? "—"}</td>
                    <td className={`py-2 ${a.ok ? "text-accent" : "text-danger"}`}>{a.detail || (a.ok ? "OK" : "Failed")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Layout>
  );
}

function KeyCard({ status, onChange, onError }: { status: ProviderKeyStatus; onChange: (d: KeysPayload) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const src = SOURCE[status.source];

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    onError("");
    setResult(null);
    try {
      await fn();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : `${label} failed`);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-subtle text-ink">
            <KeyIcon width={18} height={18} />
          </span>
          <div>
            <h2 className="font-semibold text-ink">{status.label.split(" — ")[0]}</h2>
            <p className="text-xs text-muted">{status.label.split(" — ")[1]}</p>
          </div>
        </div>
        <span className={`chip shrink-0 ${src.cls}`}>{src.text}</span>
      </div>

      <p className="mt-4 font-mono text-sm text-ink">{status.last4 ? `••••••••••••${status.last4}` : "—"}</p>
      <p className="text-xs text-muted">
        {status.updated_at ? `Updated ${new Date(status.updated_at).toLocaleString()} by ${status.updated_by ?? "unknown"}` : status.source === "env" ? "Set in the server .env file" : "No key yet"}
      </p>

      {editing ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run("Save", async () => {
              onChange(await adminApi.setKey(status.name, value));
              setValue("");
              setEditing(false);
            });
          }}
        >
          <label className="label" htmlFor={`key-${status.name}`}>
            New key
          </label>
          <input
            id={`key-${status.name}`}
            className="field font-mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={status.name === "anthropic_api_key" ? "sk-ant-…" : "Paste the key"}
          />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={!value.trim() || Boolean(busy)}>
              {busy === "Save" ? "Saving…" : "Save encrypted"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => (setEditing(false), setValue(""))}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setEditing(true)}>
            {status.source === "admin" ? "Replace key" : "Add key"}
          </button>
          <button
            className="btn-secondary"
            disabled={status.source === "none" || Boolean(busy)}
            onClick={() => void run("Test", async () => setResult(await adminApi.testKey(status.name)))}
          >
            {busy === "Test" ? "Testing…" : "Test"}
          </button>
          {status.source === "admin" && (
            <button
              className="btn-ghost text-danger"
              disabled={Boolean(busy)}
              onClick={() => {
                if (window.confirm("Remove this key? The server falls back to the .env key, if any.")) void run("Remove", async () => onChange(await adminApi.clearKey(status.name)));
              }}
            >
              Remove
            </button>
          )}
        </div>
      )}
      {result && (
        <p className={`mt-3 flex items-center gap-1.5 text-sm ${result.ok ? "text-accent" : "text-danger"}`} role="status">
          {result.ok && <CheckIcon width={16} height={16} />}
          {result.detail}
        </p>
      )}
    </div>
  );
}
