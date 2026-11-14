import { Link } from "react-router-dom";

import { useAuth } from "../auth";
import { ArrowIcon, ConversationIcon, GlobeIcon, MeetingIcon, MicIcon, ShieldIcon, SpeakerIcon } from "../components/Icons";
import { Layout } from "../components/Layout";
import { LiveDemo } from "../components/LiveDemo";
import { VoiceOrb } from "../components/VoiceOrb";

const steps = [
  { icon: MicIcon, n: "01", title: "You speak naturally", body: "Talk in Tamil, Hindi or English, the way you normally would." },
  { icon: GlobeIcon, n: "02", title: "AI translates in flight", body: "Each sentence is recognised and translated in about a couple of seconds." },
  { icon: SpeakerIcon, n: "03", title: "They hear their language", body: "A natural voice speaks the translation to the other person, with optional subtitles." },
];

const features = [
  { icon: ConversationIcon, title: "Two-way voice calls", body: "Internet calls where both people speak their own language." },
  { icon: MeetingIcon, title: "Meetings with notes", body: "Record or live-translate a meeting, then get a transcript and AI notes." },
  { icon: GlobeIcon, title: "Instant translate", body: "Type, speak or photograph text and hear it in another language." },
  { icon: ShieldIcon, title: "Private by default", body: "Calls are not recorded unless everyone agrees. Only you can open your meetings." },
];

export function Landing() {
  const { user } = useAuth();
  return (
    <Layout wide>
      <section className="grid items-center gap-10 pt-4 pb-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:pt-10">
        <div>
          <span className="chip border border-neon/30 bg-neon-soft font-mono tracking-wider text-neon uppercase">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neon" />
            Tamil ↔ Hindi ↔ English
          </span>
          <h1 className="mt-5 text-[2.6rem] leading-[1.05] font-bold tracking-tight text-ink sm:text-6xl">
            Speak your language.
            <br />
            <span className="gradient-text neon-text">Be understood in theirs.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Live AI voice translation for calls, meetings and face-to-face conversations. No lessons, no typing, no waiting for an
            interpreter — just talk.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to={user ? "/new" : "/login?next=/new"} className="btn-primary px-6 py-3.5 text-base">
              Start a call <ArrowIcon width={18} height={18} />
            </Link>
            <Link to={user ? "/start" : "/login?next=/start"} className="btn-secondary px-6 py-3.5 text-base">
              Join with a code
            </Link>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 font-mono">
            {[
              ["3", "languages"],
              ["2 way", "voice"],
              ["0", "recordings by default"],
            ].map(([v, k]) => (
              <div key={k} className="border-l border-line pl-3">
                <dt className="text-xl font-semibold text-ink">{v}</dt>
                <dd className="text-[11px] tracking-wide text-muted uppercase">{k}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="relative">
          <VoiceOrb className="max-w-[300px] sm:max-w-[340px]" />
          <div className="relative z-10 -mt-14 sm:-mt-16">
            <LiveDemo />
          </div>
        </div>
      </section>

      <section className="mt-20">
        <p className="eyebrow">// how it works</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">Three steps, one conversation</h2>
        <div className="relative mt-8 grid gap-4 sm:grid-cols-3">
          <div className="pointer-events-none absolute top-[3.4rem] right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-brand/0 via-neon/60 to-brand/0 sm:block" />
          {steps.map(({ icon: Icon, n, title, body }) => (
            <div key={title} className="card card-hover glow-border p-6">
              <div className="flex items-center justify-between">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand shadow-[0_0_30px_-6px_rgb(138_123_255/0.8)]">
                  <Icon width={22} height={22} />
                </span>
                <span className="mono-readout text-sm text-muted">{n}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <p className="eyebrow">// what you get</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">Built for real conversations</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card card-hover p-5">
              <Icon className="text-neon" width={22} height={22} />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card glow-border mt-20 overflow-hidden p-8 text-center sm:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,rgb(138_123_255/0.35),transparent_60%)]" />
        <h2 className="relative text-3xl font-bold tracking-tight sm:text-4xl">
          Ready to <span className="gradient-text">talk across languages</span>?
        </h2>
        <p className="relative mx-auto mt-3 max-w-lg text-muted">Create an account, pick your language and share a code. It takes under a minute.</p>
        <Link to={user ? "/new" : "/login?next=/new"} className="btn-primary relative mt-7 px-7 py-3.5 text-base">
          Start now <ArrowIcon width={18} height={18} />
        </Link>
        <p className="relative mt-5 text-xs text-muted">
          Works for calls made inside this app (browser and mobile). It does not translate regular phone or WhatsApp calls.
        </p>
      </section>
    </Layout>
  );
}
