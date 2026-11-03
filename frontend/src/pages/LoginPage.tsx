import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { ErrorBanner, Layout } from "../components/Layout";

function safeNext(next: string | null): string {
  // Only allow in-app relative paths (prevents open redirects).
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/start";
}

export function LoginPage() {
  const { user, setUser } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={safeNext(params.get("next"))} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setUser(mode === "login" ? await api.login(username, password) : await api.register(username, password, displayName));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-muted">Both people on a call need an account.</p>
        <div className="mt-6 grid grid-cols-2 rounded-xl bg-subtle p-1 text-sm font-medium">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg py-2 ${mode === m ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {m === "login" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="card mt-4 space-y-4 p-6">
          {error && <ErrorBanner message={error} />}
          <label className="block">
            <span className="label">Username</span>
            <input className="field" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          {mode === "register" && (
            <label className="block">
              <span className="label">Name shown on calls</span>
              <input className="field" value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          )}
          <label className="block">
            <span className="label">Password</span>
            <input
              className="field"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </Layout>
  );
}
