import { Link } from "react-router-dom";

import { useAuth } from "../auth";
import { ArrowIcon, MicIcon, ShieldIcon, SpeakerIcon } from "../components/Icons";
import { Layout } from "../components/Layout";

const steps = [
  { icon: MicIcon, title: "You speak naturally", body: "Talk in Tamil, Hindi or English, the way you normally would." },
  { icon: SpeakerIcon, title: "They hear their language", body: "Each sentence is recognised, translated and spoken in the other person's language." },
  { icon: ShieldIcon, title: "Private by default", body: "Calls are not recorded. Meetings are saved only with consent, and only you can open them." },
];

export function Landing() {
  const { user } = useAuth();
  return (
    <Layout wide>
      <section className="grid items-center gap-10 py-6 lg:grid-cols-2">
        <div>
          <span className="chip bg-brand-soft text-brand">Tamil ↔ Hindi · English</span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            Speak your language.
            <br />
            Be understood in theirs.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
            A two-person internet voice call with live AI translation in both directions, plus optional subtitles. Built for
            conversations between Tamil, Hindi and English speakers.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={user ? "/new" : "/login?next=/new"} className="btn-primary px-5 py-3">
              Start a call <ArrowIcon width={18} height={18} />
            </Link>
            <Link to={user ? "/start" : "/login?next=/start"} className="btn-secondary px-5 py-3">
              Join with a code
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted">
            Works for calls made inside this app (browser, WebRTC). It does not translate regular phone or WhatsApp calls.
          </p>
        </div>
        <div className="card p-6">
          <div className="space-y-3">
            <Bubble side="left" lang="தமிழ்" text="வணக்கம், இன்று கூட்டம் எத்தனை மணிக்கு?" sub="नमस्ते, आज मीटिंग कितने बजे है?" />
            <Bubble side="right" lang="हिन्दी" text="चार बजे, मैं लिंक भेज दूँगा।" sub="நான்கு மணிக்கு, நான் இணைப்பை அனுப்புகிறேன்." />
          </div>
          <p className="mt-4 text-center text-xs text-muted">Illustration of the subtitle view</p>
        </div>
      </section>
      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {steps.map(({ icon: Icon, title, body }) => (
          <div key={title} className="card p-5">
            <Icon className="text-brand" />
            <h3 className="mt-3 font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </div>
        ))}
      </section>
    </Layout>
  );
}

function Bubble({ side, lang, text, sub }: { side: "left" | "right"; lang: string; text: string; sub: string }) {
  return (
    <div className={`flex ${side === "right" ? "justify-end" : ""}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${side === "right" ? "bg-brand text-white" : "bg-subtle text-ink"}`}>
        <div className={`text-[11px] font-semibold uppercase tracking-wide ${side === "right" ? "text-indigo-200" : "text-muted"}`}>{lang}</div>
        <div className="mt-0.5 text-[15px]">{text}</div>
        <div className={`mt-1.5 border-t pt-1.5 text-sm ${side === "right" ? "border-white/20 text-indigo-100" : "border-line text-muted"}`}>{sub}</div>
      </div>
    </div>
  );
}
