import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { ErrorBanner, Layout } from "../components/Layout";
import { VoiceOrb } from "../components/VoiceOrb";

function safeNext(next: string | null): string {
  // Only allow in-app relative paths (prevents open redirects).
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/start";
}

export function LoginPage() {
  const { user, setUser } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [justRegistered, setJustRegistered] = useState(false);
  const [notice, setNotice] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // New accounts go to Settings first so they can add a mobile number for calls.
  if (user) return <Navigate to={justRegistered ? "/settings" : safeNext(params.get("next"))} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        setUser(await api.login(username, password));
      } else {
        const created = await api.register(username, password, displayName);
        setJustRegistered(true);
        setUser(created);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout wide>
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="hidden lg:block">
          <p className="eyebrow">// secure access</p>
          <h2 className="mt-3 text-4xl font-bold tracking-tight">
            Talk across <span className="gradient-text neon-text">languages</span>, instantly.
          </h2>
          <p className="mt-4 max-w-md text-muted">Sign in to start a call, translate on the spot or turn a meeting into a transcript with notes.</p>
          <VoiceOrb className="mt-4 max-w-[340px]" />
        </div>
      <div className="mx-auto w-full max-w-md">
        <h1 className="gradient-text text-3xl font-bold tracking-tight">
          {mode === "login" ? "Sign in" : mode === "register" ? "Create your account" : "Reset your password"}
        </h1>
        <p className="mt-1 text-sm text-muted">Both people on a call need an account.</p>
        {notice && <p className="mt-4 rounded-xl bg-subtle p-3 text-sm text-accent">{notice}</p>}
        {mode !== "reset" && (
          <div className="mt-6 grid grid-cols-2 rounded-xl bg-subtle p-1 text-sm font-medium">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setNotice("");
                }}
                className={`rounded-lg py-2 ${mode === m ? "bg-surface shadow-sm" : "text-muted"}`}
              >
                {m === "login" ? "Sign in" : "Register"}
              </button>
            ))}
          </div>
        )}
        {mode === "reset" && (
          <ResetPasswordForm
            onBack={() => setMode("login")}
            onDone={() => {
              setMode("login");
              setNotice("Password changed. Sign in with your new password.");
            }}
          />
        )}
        <form onSubmit={submit} className={`card mt-4 space-y-4 p-6 ${mode === "reset" ? "hidden" : ""}`}>
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
          {mode === "login" && (
            <button type="button" className="w-full text-sm text-muted underline" onClick={() => setMode("reset")}>
              Forgot password?
            </button>
          )}
        </form>
      </div>
      </div>
    </Layout>
  );
}

function ResetPasswordForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-4 space-y-4 p-6">
      {error && <ErrorBanner message={error} />}
      {!sentTo ? (
        <>
          <p className="text-sm text-muted">
            Enter the mobile number saved in your account Settings. We send a code to it by SMS. If you never added a number, ask an administrator to
            reset your password.
          </p>
          <label className="block">
            <span className="label">Mobile number</span>
            <input className="field" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone} maxLength={16} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <button
            className="btn-primary w-full"
            disabled={busy || phone.replace(/\D/g, "").length < 10}
            onClick={() => void run(async () => setSentTo((await api.requestPasswordReset(phone)).sent_to), "Could not send the code")}
          >
            Send code
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">If that number belongs to an account, a code was sent to {sentTo}.</p>
          <label className="block">
            <span className="label">6-digit code</span>
            <input className="field" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={8} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">New password</span>
            <input className="field" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button
            className="btn-primary w-full"
            disabled={busy || code.trim().length < 4 || password.length < 8}
            onClick={() => void run(async () => { await api.confirmPasswordReset(phone, code.trim(), password); onDone(); }, "Could not reset the password")}
          >
            Set new password
          </button>
          <button className="w-full text-sm text-muted underline" onClick={() => setSentTo("")}>
            Use a different number
          </button>
        </>
      )}
      <button className="w-full text-sm text-muted underline" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  );
}
