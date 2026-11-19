import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api, meetingsApi } from "../api";
import { useAuth } from "../auth";
import { ArrowIcon, ClockIcon, KeypadIcon, SwapIcon } from "../components/Icons";
import { Layout } from "../components/Layout";
import { Reveal } from "../components/warm/Reveal";
import { useReducedMotion } from "../components/warm/hooks";
import { languageName } from "../lib/languages";
import type { MeetingListItem, Room } from "../types";

const GREETINGS = [
  { text: "வணக்கம்", font: "wm-tamil" },
  { text: "नमस्ते", font: "wm-deva" },
  { text: "Hello", font: "font-display italic" },
];

function partOfDay() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Two voices and a word on its way between them. */
function CallArt({ still }: { still: boolean }) {
  return (
    <svg viewBox="0 0 220 150" className="h-full w-full" aria-hidden="true">
      <circle cx="46" cy="84" r="30" fill="#1c1712" />
      <text x="46" y="94" textAnchor="middle" fontSize="28" fontWeight="800" fill="#f5a623" style={{ fontFamily: "var(--font-display)" }}>P</text>
      <circle cx="176" cy="84" r="30" fill="#1f2d6e" stroke="#1c1712" strokeWidth="3" />
      <text x="176" y="94" textAnchor="middle" fontSize="28" fontWeight="800" fill="#fffaf0" style={{ fontFamily: "var(--font-display)" }}>A</text>
      <path d="M52 52 Q111 -8 170 52" fill="none" stroke="#1c1712" strokeWidth="2.6" strokeDasharray="1 7" strokeLinecap="round" />
      <g transform={still ? "translate(111 14)" : undefined}>
        <circle r="11" fill="#d6402a" stroke="#1c1712" strokeWidth="2.5" />
        <circle r="3.5" fill="#fffaf0" />
        {!still && <animateMotion dur="2.6s" repeatCount="indefinite" path="M52 52 Q111 -8 170 52" keyPoints="0;1;1" keyTimes="0;0.8;1" calcMode="linear" />}
      </g>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={20 + i * 7} y={128 - (i % 2 ? 9 : 14)} width="4" height={i % 2 ? 18 : 28} rx="2" fill="#1c1712" className={still ? "" : "wm-bar"} style={{ transformOrigin: "50% 100%", ["--i" as string]: i }} />
      ))}
    </svg>
  );
}

/** A word that turns into the same word in the next language. */
function MorphWord({ still }: { still: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setI((n) => (n + 1) % GREETINGS.length), 2300);
    return () => clearInterval(t);
  }, [still]);
  const g = GREETINGS[i];
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span key={g.text} className={`wm-word text-[2rem] leading-none ${g.font}`} style={{ ["--i" as string]: 0 }}>
        {g.text}
      </span>
      <SwapIcon width={22} height={22} />
    </div>
  );
}

function FaceArt({ still }: { still: boolean }) {
  return (
    <svg viewBox="0 0 160 80" className="h-full w-full" aria-hidden="true">
      <g className={still ? "" : "wm-wobble"} style={{ transformOrigin: "40px 60px" }}>
        <path d="M10 70 A30 30 0 0 1 70 70 Z" fill="#1c1712" />
        <circle cx="40" cy="30" r="12" fill="#1c1712" />
      </g>
      <g className={still ? "" : "wm-wobble"} style={{ transformOrigin: "120px 60px", animationDelay: "-2s" }}>
        <path d="M90 70 A30 30 0 0 1 150 70 Z" fill="#d6402a" stroke="#1c1712" strokeWidth="2.5" />
        <circle cx="120" cy="30" r="12" fill="#d6402a" stroke="#1c1712" strokeWidth="2.5" />
      </g>
    </svg>
  );
}

function NotesArt({ still }: { still: boolean }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[70, 52, 62].map((w, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="grid h-5 w-5 place-items-center rounded-md border-2 border-edge bg-surface">
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="#1f2d6e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6.5 5 9.5 10 3" pathLength="1" className={still ? "" : "wm-draw"} style={{ ["--dd" as string]: `${0.4 + i * 0.5}s`, animationIterationCount: "infinite", animationDuration: "3s" }} strokeDasharray="1" />
            </svg>
          </span>
          <span className="h-2 rounded-full bg-edge/80" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

function DialArt({ still }: { still: boolean }) {
  return (
    <div className="grid w-fit grid-cols-3 gap-2" aria-hidden="true">
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className="h-3.5 w-3.5 rounded-full border-2 border-edge bg-saffron" style={still ? undefined : { animation: "wm-dot 2.4s ease-in-out infinite", animationDelay: `${i * 0.18}s` }} />
      ))}
    </div>
  );
}

function Tile({ to, className, tilt, title, body, children }: { to: string; className: string; tilt: number; title: string; body: string; children: ReactNode }) {
  return (
    <Link to={to} className={`card card-hover group relative flex min-h-[11.5rem] flex-col overflow-hidden p-6 hover:!rotate-0 ${className}`} style={{ rotate: `${tilt}deg` }}>
      <h2 className="page-title text-[1.7rem]">{title}</h2>
      <p className="mt-1.5 max-w-[16rem] text-[0.95rem] leading-snug">{body}</p>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pt-5">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
          Open <ArrowIcon width={16} height={16} className="transition group-hover:translate-x-1" />
        </span>
        <div className="shrink-0">{children}</div>
      </div>
    </Link>
  );
}

export function StartPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const still = useReducedMotion();
  const [code, setCode] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [g, setG] = useState(0);

  useEffect(() => {
    api.rooms().then(setRooms).catch(() => setRooms([]));
    meetingsApi.list({ page: 1 }).then((r) => setMeetings(r.results.slice(0, 4))).catch(() => setMeetings([]));
  }, []);
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setG((n) => (n + 1) % GREETINGS.length), 3400);
    return () => clearInterval(t);
  }, [still]);

  function join(e: FormEvent) {
    e.preventDefault();
    const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (clean) navigate(`/join/${clean}`);
  }

  const first = (user?.preferences.display_name || user?.username || "").split(" ")[0];
  const greet = GREETINGS[g];

  return (
    <Layout wide>
      {/* greeting */}
      <header className="mb-8">
        <p className="wm-hand text-[1.2rem] text-neon">{partOfDay()}. What shall we do today?</p>
        <h1 className="page-title mt-1 text-[clamp(2.4rem,6.5vw,4.4rem)]">
          <span key={greet.text} className={`wm-word mr-3 ${greet.font}`} style={{ ["--i" as string]: 0 }}>
            {greet.text}
          </span>
          <span className="whitespace-nowrap">{first}.</span>
        </h1>
      </header>

      {/* join with a code */}
      <form onSubmit={join} className="relative mb-9 flex max-w-xl flex-col overflow-hidden rounded-2xl border-[2.5px] border-edge bg-butter text-[#1c1712] shadow-[4px_4px_0_var(--color-shadow)] sm:flex-row sm:items-stretch">
        <label htmlFor="code" className="flex items-center gap-2 px-4 py-3 text-sm font-extrabold tracking-wide uppercase sm:border-r-2 sm:border-dashed sm:border-edge">
          <KeypadIcon width={18} height={18} /> Have a code?
        </label>
        <div className="flex flex-1 items-center gap-2 border-t-2 border-dashed border-edge p-2 sm:border-t-0">
          <input
            id="code"
            className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-edge bg-surface px-3 font-mono text-lg tracking-[0.22em] text-ink uppercase placeholder:text-muted/70 focus:outline-none"
            placeholder="ABCD2345"
            autoComplete="off"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="btn-secondary !min-h-11" disabled={!code.trim()}>
            Join <ArrowIcon width={16} height={16} />
          </button>
        </div>
      </form>

      {/* what would you like to do */}
      <div className="grid gap-6 md:grid-cols-6">
        <Reveal className="md:col-span-4">
          <Tile to="/new" tilt={-0.5} className="h-full !bg-saffron !text-[#1c1712]" title="Start a call" body="Pick your language, share the invite code, and talk. Each of you hears your own.">
            <div className="hidden h-36 w-64 sm:block">
              <CallArt still={still} />
            </div>
          </Tile>
        </Reveal>
        <Reveal className="md:col-span-2" delay={80}>
          <Tile to="/translate" tilt={0.7} className="h-full !bg-blush !text-[#1c1712]" title="Translate" body="Type or speak, then hear it in another language.">
            <MorphWord still={still} />
          </Tile>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0}>
          <Tile to="/face" tilt={0.6} className="h-full !bg-butter !text-[#1c1712]" title="Face to face" body="One phone between two people, both languages on screen.">
            <div className="h-16 w-32">
              <FaceArt still={still} />
            </div>
          </Tile>
        </Reveal>
        <Reveal className="md:col-span-2" delay={80}>
          <Tile to="/meetings" tilt={-0.6} className="h-full !bg-mist !text-[#1c1712]" title="Meetings" body="Record or go live, then get the transcript and notes.">
            <div className="w-28">
              <NotesArt still={still} />
            </div>
          </Tile>
        </Reveal>
        <Reveal className="md:col-span-2" delay={160}>
          <Tile to="/dial" tilt={0.5} className="h-full" title="Dial" body="Call another person on Asta Talk by name or number.">
            <DialArt still={still} />
          </Tile>
        </Reveal>
      </div>

      {/* recent */}
      <div className="mt-14 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="recent-calls">
          <h2 id="recent-calls" className="page-title text-[1.6rem]">
            Recent calls
          </h2>
          {rooms.length === 0 ? (
            <p className="wm-hand mt-4 text-[1.1rem] text-muted">No calls yet. The first one is always the most fun.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {rooms.slice(0, 5).map((room) => {
                const other = room.participants.find((p) => !p.is_you);
                const ended = room.status === "ended";
                return (
                  <li key={room.code}>
                    <Link to={ended ? `/call/${room.code}/summary` : `/call/${room.code}`} className="card card-hover flex items-center gap-4 !rounded-2xl px-4 py-3 !shadow-[3px_3px_0_var(--color-shadow)]">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-edge bg-saffron text-lg font-extrabold text-[#1c1712]" style={{ fontFamily: "var(--font-display)" }} aria-hidden="true">
                        {(other?.display_name || "?").slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{other ? other.display_name : ended ? "Nobody joined" : "Waiting for someone to join"}</p>
                        <p className="truncate text-xs text-muted">
                          {new Date(room.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {room.participants.map((p) => languageName(p.spoken_language)).join(" ↔ ")}
                        </p>
                      </div>
                      <span className={`chip ${ended ? "bg-subtle text-muted" : "bg-accent-soft text-accent"}`}>{ended ? "Summary" : room.status === "active" ? "Live" : "Rejoin"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent-meetings">
          <h2 id="recent-meetings" className="page-title text-[1.6rem]">
            Recent meetings
          </h2>
          {meetings.length === 0 ? (
            <p className="wm-hand mt-4 text-[1.1rem] text-muted">Nothing recorded yet. Meeting notes will pile up here.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {meetings.map((m) => (
                <li key={m.id}>
                  <Link to={`/meetings/${m.id}`} className="card card-hover flex items-center gap-4 !rounded-2xl px-4 py-3 !shadow-[3px_3px_0_var(--color-shadow)]">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-edge bg-mist text-[#1c1712]" aria-hidden="true">
                      <ClockIcon width={20} height={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{m.title}</p>
                      <p className="truncate text-xs text-muted">
                        {new Date(m.recorded_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {Math.max(1, Math.round(m.duration_seconds / 60))} min
                      </p>
                    </div>
                    {m.has_summary && <span className="chip bg-brand-soft text-brand">Notes</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  );
}
