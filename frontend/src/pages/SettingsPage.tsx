import { useEffect, useState } from "react";

import { ApiError, api, planApi, type LanguageSelection } from "../api";
import { useAuth } from "../auth";
import { LanguagePicker } from "../components/LanguagePicker";
import { Meter } from "../components/admin/Stats";
import { ErrorBanner, Layout } from "../components/Layout";
import type { MyPlan, UsageSummary } from "../types";

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const prefs = user!.preferences;
  const [displayName, setDisplayName] = useState(prefs.display_name);
  const [sel, setSel] = useState<LanguageSelection>({
    spoken_language: prefs.spoken_language,
    listen_language: prefs.listen_language,
    voice: prefs.voice,
  });
  const [volume, setVolume] = useState(prefs.original_voice_volume);
  const [subtitles, setSubtitles] = useState(prefs.show_subtitles);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    api.usage().then(setUsage).catch(() => setUsage(null));
  }, []);

  async function save() {
    setSaved("");
    setError("");
    try {
      await api.savePreferences({
        display_name: displayName,
        spoken_language: sel.spoken_language,
        listen_language: sel.listen_language,
        voice: sel.voice ?? "",
        original_voice_volume: volume,
        show_subtitles: subtitles,
      });
      await refresh();
      setSaved("Saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    }
  }

  return (
    <Layout>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <PlanCard />
      <div className="card mt-6 space-y-6 p-6">
        {error && <ErrorBanner message={error} />}
        <label className="block">
          <span className="label">Name shown on calls</span>
          <input className="field" value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <LanguagePicker value={sel} onChange={setSel} />
        <label className="block">
          <span className="label">Default original-voice volume under translation: {volume}%</span>
          <input type="range" min={0} max={100} step={5} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-full" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} /> Show live subtitles by default
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={() => void save()}>
            Save settings
          </button>
          {saved && <span className="text-sm text-accent">{saved}</span>}
        </div>
      </div>

      <h2 className="mt-10 text-lg font-semibold">Usage</h2>
      {usage ? (
        <div className="card mt-3 space-y-5 p-6">
          <p className="text-sm text-muted">
            Today, across all calls on this server (limits protect the AI budget).
            {!usage.translation_enabled && " AI translation is currently disabled on the server."}
          </p>
          <Meter label="Call time" used={usage.today.call_seconds} limit={usage.daily_limits.call_seconds} unit="s" />
          <Meter label="Speech recognition" used={usage.today.stt_seconds} limit={usage.daily_limits.stt_seconds} unit="s" />
          <Meter label="Translation" used={usage.today.translate_chars} limit={usage.daily_limits.translate_chars} unit="chars" />
          <Meter label="Speech synthesis" used={usage.today.tts_chars} limit={usage.daily_limits.tts_chars} unit="chars" />
          <p className="border-t border-line pt-4 text-sm text-muted">
            Your calls: {usage.mine.calls} · {Math.round(usage.mine.call_seconds / 60)} min · max {Math.round(usage.max_call_duration_seconds / 60)} min per
            call
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Usage is unavailable.</p>
      )}
    </Layout>
  );
}

function PlanCard() {
  const [data, setData] = useState<MyPlan | null>(null);
  useEffect(() => {
    planApi.mine().then(setData).catch(() => undefined);
  }, []);
  if (!data?.plan) return null;
  const { plan, usage } = data;
  return (
    <section className="card mt-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Your plan</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {plan.name} <span className="text-sm font-normal text-muted">· ₹{plan.price_inr_month}/month</span>
          </h2>
          {plan.description && <p className="text-sm text-muted">{plan.description}</p>}
        </div>
        {data.unlimited && <span className="chip bg-brand-soft text-brand">Administrator — no limits</span>}
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Meter label="Call minutes today" used={usage.call_minutes_today} limit={plan.daily_call_minutes} unit="min" />
        <Meter label="Assistant today" used={usage.assistant_requests_today} limit={plan.daily_assistant_requests} unit="requests" />
        <Meter label="Meetings this month" used={usage.meeting_minutes_this_month} limit={plan.monthly_meeting_minutes} unit="min" />
        {plan.phone_calls && <Meter label="Phone calls today" used={usage.phone_calls_today} limit={plan.daily_phone_calls} unit="calls" />}
      </div>
      {!data.payments && data.plans.length > 1 && <p className="mt-4 text-xs text-muted">To change plan, contact your administrator.</p>}
    </section>
  );
}
