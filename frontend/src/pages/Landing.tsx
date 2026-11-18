import { Link } from "react-router-dom";

import { useAuth } from "../auth";
import { ArrowIcon, ConversationIcon, GlobeIcon, MeetingIcon, MicIcon, ShieldIcon, SpeakerIcon, SwapIcon } from "../components/Icons";
import { Marquee, Star } from "../components/warm/Marquee";
import { Reveal } from "../components/warm/Reveal";
import { Stage } from "../components/warm/Stage";
import { Stamp } from "../components/warm/Stamp";
import { WarmShell } from "../components/warm/WarmShell";

const steps = [
  { icon: MicIcon, title: "You speak naturally", body: "Talk in Tamil, Hindi or English, the way you normally would.", tint: "bg-butter", tilt: -1.6 },
  { icon: GlobeIcon, title: "It translates in flight", body: "Each sentence is recognised and translated in about a couple of seconds.", tint: "bg-blush", tilt: 1.2 },
  { icon: SpeakerIcon, title: "They hear their language", body: "A natural voice speaks the translation to the other person, with optional subtitles.", tint: "bg-mist", tilt: -0.8 },
];

/** Words that rise in one by one; `from` keeps the stagger going across lines. */
function Words({ text, from = 0 }: { text: string; from?: number }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={`${w}-${i}`} className="wm-word mr-[0.22em]" style={{ ["--i" as string]: from + i }}>
          {w}
        </span>
      ))}
    </>
  );
}

function Equalizer() {
  const heights = [40, 72, 100, 58, 84, 36, 92, 64, 48, 78, 30, 66];
  return (
    <div className="flex h-16 items-end gap-1.5" aria-hidden="true">
      {heights.map((h, i) => (
        <span key={i} className="wm-bar block w-2.5 rounded-full bg-chai" style={{ height: `${h}%`, ["--i" as string]: i }} />
      ))}
    </div>
  );
}

export function Landing() {
  const { user } = useAuth();
  const start = user ? "/new" : "/login?next=/new";
  const join = user ? "/start" : "/login?next=/start";

  return (
    <WarmShell>
      {/* ---------- hero ---------- */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-10 pb-14 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8 lg:pt-16 lg:pb-20">
        <div>
          <span className="wm-sticker -rotate-2">
            <span className="wm-tamil">தமிழ்</span>
            <SwapIcon width={16} height={16} aria-hidden="true" />
            <span className="wm-deva">हिन्दी</span>
            <SwapIcon width={16} height={16} aria-hidden="true" />
            English
          </span>
          <h1 className="wm-display mt-6 text-[clamp(2.9rem,8.2vw,5.9rem)]">
            <span className="block">
              <Words text="Say it" />
              <span className="wm-mark rounded-sm px-1">
                <Words text="your way." from={2} />
              </span>
            </span>
            <span className="mt-1 block">
              <Words text="They'll hear it" from={4} />
              <span className="relative inline-block">
                <span className="wm-word text-chilli-text" style={{ ["--i" as string]: 7 }}>
                  theirs.
                </span>
                <svg className="pointer-events-none absolute -bottom-2 left-0 h-3.5 w-full overflow-visible" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M2 9 C 22 2, 38 14, 60 7 S 100 1, 122 8 S 168 13, 198 4" fill="none" stroke="var(--color-chilli)" strokeWidth="5" strokeLinecap="round" pathLength="1" className="wm-draw" />
                </svg>
              </span>
            </span>
          </h1>
          <p className="mt-8 max-w-xl text-[1.2rem] leading-relaxed text-muted">
            Live voice translation for calls, meetings and face-to-face talk. No lessons, no typing, no waiting for an interpreter. Just talk.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-4">
            <Link to={start} className="wm-btn">
              Start a call <ArrowIcon width={18} height={18} aria-hidden="true" />
            </Link>
            <Link to={join} className="wm-btn wm-btn-quiet">
              Join with a code
            </Link>
          </div>
          <dl className="mt-11 flex max-w-lg flex-wrap gap-x-8 gap-y-4">
            {[
              ["3", "languages"],
              ["2-way", "voice"],
              ["0", "recordings unless everyone agrees"],
            ].map(([v, k]) => (
              <div key={k} className="flex items-baseline gap-2">
                <dt className="wm-title text-[2rem]">{v}</dt>
                <dd className="max-w-[9rem] text-[0.88rem] leading-tight text-muted">{k}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative">
          <Stage />
          <p className="wm-hand absolute -bottom-10 left-2 hidden -rotate-3 items-center gap-2 text-[1.15rem] text-chilli-text lg:flex" aria-hidden="true">
            <svg width="46" height="34" viewBox="0 0 46 34" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 30 C 8 12, 24 6, 40 8" />
              <path d="M32 2 L41 8 L33 15" />
            </svg>
            it really talks back, try it
          </p>
        </div>
      </section>

      <Marquee />

      {/* ---------- how it works ---------- */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-16 pb-6 sm:px-6">
        <Reveal>
          <p className="wm-eyebrow text-chilli-text">How it works</p>
          <h2 className="wm-title mt-2 text-[clamp(2.1rem,5vw,3.4rem)]">
            Three steps,{" "}
            <span className="relative inline-block">
              one conversation
              <svg className="absolute -bottom-1.5 left-0 h-3 w-full overflow-visible" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 7 C 30 1, 60 11, 100 6 S 170 2, 198 8" fill="none" stroke="var(--color-saffron-deep)" strokeWidth="4.5" strokeLinecap="round" pathLength="1" className="wm-draw-view" />
              </svg>
            </span>
            .
          </h2>
        </Reveal>
        <ol className="mt-12 grid gap-8 md:grid-cols-3 md:gap-7">
          {steps.map(({ icon: Icon, title, body, tint, tilt }, i) => (
            <li key={title}>
              <Reveal delay={i * 130} tilt={tilt}>
                <div className={`wm-card wm-lift relative h-full p-7 ${tint}`} style={{ transform: `rotate(${tilt}deg)` }}>
                  <span className="wm-display absolute -top-7 -left-3 text-[5rem] text-chilli [-webkit-text-stroke:2.5px_var(--color-chai)]" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="mt-6 grid h-14 w-14 place-items-center rounded-2xl border-[2.5px] border-chai bg-jasmine shadow-[3px_3px_0_var(--color-chai)]">
                    <Icon width={26} height={26} aria-hidden="true" />
                  </span>
                  <h3 className="wm-title mt-5 text-[1.55rem]">{title}</h3>
                  <p className="mt-2 leading-relaxed">{body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- features ---------- */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-20 pb-6 sm:px-6">
        <Reveal>
          <p className="wm-eyebrow text-chilli-text">What you get</p>
          <h2 className="wm-title mt-2 text-[clamp(2.1rem,5vw,3.4rem)]">Built for real conversations</h2>
        </Reveal>
        <div className="mt-12 grid gap-7 md:grid-cols-6">
          <Reveal className="md:col-span-4" delay={0} tilt={-0.6}>
            <div className="wm-card wm-lift h-full overflow-hidden bg-saffron p-7 sm:p-8">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <ConversationIcon width={34} height={34} aria-hidden="true" />
                  <h3 className="wm-title mt-4 text-[1.9rem]">Two-way voice calls</h3>
                  <p className="mt-2 max-w-md text-[1.05rem] leading-relaxed">Internet calls where both people speak their own language and hear the other in theirs.</p>
                </div>
                <div className="hidden shrink-0 sm:block">
                  <Equalizer />
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal className="md:col-span-2" delay={120} tilt={0.8}>
            <div className="wm-card wm-lift h-full bg-neel p-7 text-jasmine">
              <MeetingIcon width={34} height={34} aria-hidden="true" />
              <h3 className="wm-title mt-4 text-[1.6rem]">Meetings with notes</h3>
              <p className="mt-2 leading-relaxed text-jasmine/90">Record or live-translate a meeting, then get a transcript and notes.</p>
              <ul className="wm-hand mt-4 space-y-1 text-[1.05rem] text-butter" aria-hidden="true">
                <li>✓ Decision: pilot starts Monday</li>
                <li>○ Priya sends the draft</li>
              </ul>
            </div>
          </Reveal>
          <Reveal className="md:col-span-3" delay={0} tilt={0.5}>
            <div className="wm-card wm-lift h-full bg-blush p-7">
              <GlobeIcon width={34} height={34} aria-hidden="true" />
              <h3 className="wm-title mt-4 text-[1.6rem]">Instant translate</h3>
              <p className="mt-2 leading-relaxed">Type, speak or photograph text and hear it in another language.</p>
              <div className="mt-4 flex flex-wrap gap-2.5" aria-hidden="true">
                {["type it", "say it", "snap it"].map((t) => (
                  <span key={t} className="wm-sticker !bg-jasmine !text-[0.82rem]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal className="md:col-span-3" delay={120} tilt={-0.5}>
            <div className="wm-card wm-lift h-full bg-butter p-7">
              <SwapIcon width={34} height={34} aria-hidden="true" />
              <h3 className="wm-title mt-4 text-[1.6rem]">Face to face</h3>
              <p className="mt-2 leading-relaxed">Put one phone between two people. Each speaks, and each reads and hears their own language.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- privacy ---------- */}
      <section id="privacy" className="wm-dots-light mt-24 scroll-mt-20 border-y-[2.5px] border-chai bg-neel text-jasmine">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1fr_auto] md:py-20">
          <Reveal>
            <p className="wm-eyebrow text-saffron">Private by default</p>
            <h2 className="wm-title mt-2 max-w-2xl text-[clamp(2.1rem,5vw,3.5rem)]">Your conversations stay yours.</h2>
            <ul className="mt-8 grid max-w-2xl gap-4 text-[1.1rem] leading-snug">
              {[
                "Calls are not recorded unless every person on the call agrees.",
                "Only you can open your meetings, transcripts and notes.",
                "Delete a meeting and its audio is deleted with it.",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Star className="mt-1 h-4 w-4 flex-none text-saffron" />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={150}>
            <Stamp text="NO RECORDING UNLESS EVERYONE AGREES ✦ " className="mx-auto w-52 text-saffron sm:w-60">
              <ShieldIcon width={56} height={56} className="text-jasmine" aria-hidden="true" />
            </Stamp>
          </Reveal>
        </div>
      </section>

      {/* ---------- final call ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <Reveal tilt={-0.6}>
          <div className="wm-card relative overflow-hidden bg-saffron px-6 py-14 text-center sm:px-12">
            <Star className="wm-spin-slow absolute -top-16 -left-16 h-56 w-56 text-butter" />
            <Star className="wm-spin-slow absolute -right-20 -bottom-20 h-64 w-64 text-butter" />
            <div className="relative">
              <h2 className="wm-display text-[clamp(2.3rem,6vw,4.4rem)]">Ready when you are.</h2>
              <p className="mx-auto mt-4 max-w-lg text-[1.15rem]">Create an account, pick your language and share a code. It takes under a minute.</p>
              <Link to={start} className="wm-btn mt-8 !bg-chai !text-jasmine hover:!bg-neel">
                Start now <ArrowIcon width={18} height={18} aria-hidden="true" />
              </Link>
              <p className="wm-hand mx-auto mt-6 max-w-xl text-[1.05rem]">
                Works for calls made inside this app (browser and phone). It does not translate regular phone or WhatsApp calls.
              </p>
            </div>
          </div>
        </Reveal>
      </section>
    </WarmShell>
  );
}
