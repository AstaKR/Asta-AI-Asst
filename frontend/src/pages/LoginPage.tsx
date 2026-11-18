import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { ErrorBanner } from "../components/Layout";
import { Stage } from "../components/warm/Stage";
import { WarmShell } from "../components/warm/WarmShell";

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
    <WarmShell nav={false}>
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:py-16">
        <div className="hidden lg:block">
          <p className="wm-eyebrow text-chilli-text">Welcome</p>
          <h2 className="wm-display mt-3 text-[clamp(2.6rem,4.4vw,3.9rem)]">Pull up a chair. Let&rsquo;s talk.</h2>
          <p className="mt-5 max-w-md text-[1.1rem] text-muted">Sign in to start a call, translate on the spot or turn a meeting into a transcript with notes.</p>
          <div className="mt-10">
            <Stage />
          </div>
        </div>
      <div className="mx-auto w-full max-w-md">
        <h1 className="wm-title text-[clamp(2.1rem,6vw,2.7rem)]">
          {mode === "login" ? "Sign in" : mode === "register" ? "Create your account" : "Reset your password"}
        </h1>
        <p className="mt-2 text-muted">Both people on a call need an account.</p>
        {notice && <p role="status" className="mt-4 rounded-2xl border-[2.5px] border-chai bg-butter p-3 text-[0.95rem] font-medium">{notice}</p>}
        {mode !== "reset" && (
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-full border-[2.5px] border-chai bg-paper-2 p-1 font-bold">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  setNotice("");
                }}
                className={`min-h-11 rounded-full py-2 transition ${mode === m ? "border-2 border-chai bg-saffron shadow-[2px_2px_0_var(--color-chai)]" : "border-2 border-transparent text-muted hover:text-chai"}`}
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
        <form onSubmit={submit} className={`wm-card mt-5 space-y-4 p-6 ${mode === "reset" ? "hidden" : ""}`}>
          {error && <ErrorBanner message={error} />}
          <label className="block">
            <span className="wm-label">Username</span>
            <input className="wm-field" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          {mode === "register" && (
            <label className="block">
              <span className="wm-label">Name shown on calls</span>
              <input className="wm-field" value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          )}
          <label className="block">
            <span className="wm-label">Password</span>
            <input
              className="wm-field"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="wm-btn w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
          {mode === "login" && (
            <button type="button" className="min-h-11 w-full text-[0.95rem] font-semibold text-muted underline underline-offset-4 hover:text-chai" onClick={() => setMode("reset")}>
              Forgot password?
            </button>
          )}
        </form>
      </div>
      </div>
    </WarmShell>
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
    <div className="wm-card mt-5 space-y-4 p-6">
      {error && <ErrorBanner message={error} />}
      {!sentTo ? (
        <>
          <p className="text-sm text-muted">
            Enter the mobile number saved in your account Settings. We send a code to it by SMS. If you never added a number, ask an administrator to
            reset your password.
          </p>
          <label className="block">
            <span className="wm-label">Mobile number</span>
            <input className="wm-field" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone} maxLength={16} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <button
            className="wm-btn w-full"
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
            <span className="wm-label">6-digit code</span>
            <input className="wm-field" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={8} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label className="block">
            <span className="wm-label">New password</span>
            <input className="wm-field" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button
            className="wm-btn w-full"
            disabled={busy || code.trim().length < 4 || password.length < 8}
            onClick={() => void run(async () => { await api.confirmPasswordReset(phone, code.trim(), password); onDone(); }, "Could not reset the password")}
          >
            Set new password
          </button>
          <button className="min-h-11 w-full text-[0.95rem] font-semibold text-muted underline underline-offset-4 hover:text-chai" onClick={() => setSentTo("")}>
            Use a different number
          </button>
        </>
      )}
      <button className="min-h-11 w-full text-[0.95rem] font-semibold text-muted underline underline-offset-4 hover:text-chai" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  );
}
