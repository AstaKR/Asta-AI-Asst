import { useEffect, useRef, useState } from "react";

import { GlobeIcon } from "../Icons";
import { Star } from "./Marquee";
import { graphemes, useReducedMotion } from "./hooks";

type Who = "priya" | "arjun";
interface Line {
  from: Who;
  tamil: string;
  hindi: string;
  english: string;
}

const LINES: Line[] = [
  { from: "priya", tamil: "வணக்கம்! நாளை சந்திப்போமா?", hindi: "नमस्ते! क्या हम कल मिलें?", english: "Hello! Shall we meet tomorrow?" },
  { from: "arjun", hindi: "हाँ, शाम को चाय पर मिलते हैं।", tamil: "சரி, மாலை தேநீருக்குச் சந்திப்போம்.", english: "Yes, let's meet over tea in the evening." },
  { from: "priya", tamil: "உங்கள் உதவிக்கு நன்றி!", hindi: "आपकी मदद के लिए धन्यवाद!", english: "Thank you for your help!" },
];

const PEOPLE = {
  priya: { name: "Priya", lang: "Tamil", font: "wm-tamil", card: "bg-saffron text-chai", chip: "bg-chai text-jasmine", rot: -3, pos: "left-0 top-[3%]" },
  arjun: { name: "Arjun", lang: "Hindi", font: "wm-deva", card: "bg-neel text-jasmine", chip: "bg-saffron text-chai", rot: 2.5, pos: "right-0 top-[44%]" },
} as const;

type Phase = "idle" | "typing" | "flying" | "landed" | "fading";

// The flight path of the little globe, in % of the stage: from Priya's side, round the right, down to Arjun.
const P0 = { x: 58, y: 24 };
const C = { x: 94, y: 22 };
const P1 = { x: 80, y: 47 };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function Bars({ on }: { on: boolean }) {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`wm-bar block w-[3px] rounded-full bg-current ${on ? "" : "!animate-none scale-y-[0.3]"}`} style={{ height: "100%", ["--i" as string]: i }} />
      ))}
    </span>
  );
}

function Person({ who, text, caret, waiting, pop, active, role }: { who: Who; text: string; caret: boolean; waiting: boolean; pop: boolean; active: boolean; role: "speaks" | "hears" }) {
  const p = PEOPLE[who];
  return (
    <div
      className={`wm-card absolute z-10 w-[66%] p-4 transition-transform duration-500 sm:p-5 ${p.card} ${p.pos} ${active ? "z-20" : ""}`}
      style={{ transform: `rotate(${p.rot}deg) scale(${active ? 1.025 : 1})` }}
    >
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 flex-none place-items-center rounded-full border-2 border-chai text-lg font-bold ${p.chip}`} style={{ fontFamily: "var(--font-display)" }}>
          {p.name[0]}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-bold">{p.name}</p>
          <p className="text-[0.8rem] opacity-90">{`${role} ${p.lang}`}</p>
        </div>
        <Bars on={active && role === "speaks"} />
      </div>
      <p className={`${p.font} mt-3 min-h-[4.6rem] text-[1.35rem] leading-[1.5] sm:min-h-[5rem] sm:text-[1.6rem] ${pop ? "wm-pop" : ""}`} lang={who === "priya" ? "ta" : "hi"}>
        {waiting ? (
          <span className="wm-wait opacity-70" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ ["--i" as string]: i }} />
            ))}
          </span>
        ) : (
          text
        )}
        {caret && <span className="wm-caret" aria-hidden="true" />}
      </p>
    </div>
  );
}

/** The hero artwork: two people talking in different languages while the words travel between them. */
export function Stage() {
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>(reduced ? "landed" : "idle");
  const [typed, setTyped] = useState(0);
  const chip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) {
      setIdx(0);
      setPhase("landed");
      return;
    }
    let stop = false;
    (async () => {
      let n = 0;
      while (!stop) {
        const i = n % LINES.length;
        const line = LINES[i];
        const spoken = graphemes(line.from === "priya" ? line.tamil : line.hindi);
        setIdx(i);
        setTyped(0);
        setPhase("idle");
        await sleep(700);
        if (stop) return;
        setPhase("typing");
        for (let k = 1; k <= spoken.length; k++) {
          if (stop) return;
          setTyped(k);
          await sleep(75);
        }
        await sleep(350);
        if (stop) return;
        setPhase("flying");
        fly(chip.current, line.from);
        await sleep(1050);
        if (stop) return;
        setPhase("landed");
        await sleep(3400);
        if (stop) return;
        setPhase("fading");
        await sleep(500);
        n++;
      }
    })();
    return () => {
      stop = true;
    };
  }, [reduced]);

  const line = LINES[idx];
  const show = (who: Who) => {
    const full = who === "priya" ? line.tamil : line.hindi;
    if (phase === "idle" || phase === "fading") return { text: "", caret: false, waiting: false, pop: false };
    if (who === line.from) {
      if (phase === "typing") return { text: graphemes(full).slice(0, typed).join(""), caret: true, waiting: false, pop: false };
      return { text: full, caret: false, waiting: false, pop: false };
    }
    if (phase === "landed") return { text: full, caret: false, waiting: false, pop: !reduced };
    return { text: "", caret: false, waiting: true, pop: false };
  };
  // Who is "in the spotlight": the speaker while talking, the listener once the words arrive.
  const spotlight = (who: Who) => (phase === "typing" || phase === "flying" ? who === line.from : phase === "landed" ? who !== line.from : false);
  const roleOf = (who: Who) => (who === line.from ? "speaks" : "hears") as "speaks" | "hears";
  const fading = phase === "fading";

  return (
    <div className="relative mx-auto aspect-[5/6.1] w-full max-w-[560px] sm:aspect-[1/1.02]" role="img" aria-label={`Example: Priya says "${LINES[0].english}" in Tamil and Arjun hears it in Hindi.`}>
      {/* the sun behind them */}
      <Star className="wm-spin-slow absolute top-[2%] left-[7%] h-[92%] w-[92%] text-butter" />
      <div className="wm-dots absolute right-[-2%] bottom-[10%] h-[24%] w-[30%] opacity-70" aria-hidden="true" />

      {/* the dotted route of the words */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden="true">
        <path d={`M${P0.x} ${P0.y} Q${C.x} ${C.y} ${P1.x} ${P1.y}`} fill="none" stroke="var(--color-chilli)" strokeWidth="2.6" strokeDasharray="0.1 7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>

      <div className={`transition-opacity duration-500 ${fading ? "opacity-0" : "opacity-100"}`}>
        <Person who="priya" role={roleOf("priya")} active={spotlight("priya")} {...show("priya")} />
        <Person who="arjun" role={roleOf("arjun")} active={spotlight("arjun")} {...show("arjun")} />
      </div>

      {/* the globe that carries the words */}
      <div
        ref={chip}
        className="pointer-events-none absolute z-30 grid h-12 w-12 place-items-center rounded-full border-[2.5px] border-chai bg-chilli text-jasmine shadow-[3px_3px_0_var(--color-chai)]"
        style={{ left: `${P0.x}%`, top: `${P0.y}%`, opacity: 0, transform: "translate(-50%,-50%)" }}
        aria-hidden="true"
      >
        <GlobeIcon width={24} height={24} />
      </div>

      {/* live sticker */}
      <div className="wm-wobble absolute top-[1%] right-[2%] z-30 grid h-[4.6rem] w-[4.6rem] place-items-center rounded-full border-[2.5px] border-chai bg-chilli text-center text-jasmine shadow-[3px_3px_0_var(--color-chai)] sm:h-[5.4rem] sm:w-[5.4rem]" aria-hidden="true">
        <span className="wm-hand text-[0.95rem] leading-[1.05] font-bold sm:text-[1.1rem]">
          live,
          <br />
          not a<br />
          recording
        </span>
      </div>

      {/* subtitles */}
      <div className="wm-card absolute inset-x-[3%] bottom-0 z-20 flex items-center gap-3 rounded-2xl !shadow-[4px_4px_0_var(--color-chai)] bg-jasmine px-4 py-2.5">
        <span className="wm-sticker !bg-butter !px-2.5 !py-0.5 !text-[0.72rem] !shadow-none">English subtitles</span>
        <p className={`min-w-0 flex-1 text-[0.98rem] italic sm:text-[1.05rem] ${phase === "landed" ? "wm-pop" : "opacity-50"}`} style={{ fontFamily: "var(--font-display)" }}>
          {phase === "landed" ? line.english : "…"}
        </p>
      </div>
    </div>
  );
}

/** Sends the globe along the curve between the two people (Web Animations API, so it follows the layout). */
function fly(el: HTMLElement | null, from: Who) {
  if (!el || typeof el.animate !== "function") return;
  const [a, b] = from === "priya" ? [P0, P1] : [P1, P0];
  const steps = 18;
  const frames: Keyframe[] = Array.from({ length: steps + 1 }, (_, k) => {
    const t = k / steps;
    const x = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * C.x + t * t * b.x;
    const y = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * C.y + t * t * b.y;
    const s = 0.75 + Math.sin(t * Math.PI) * 0.55;
    return { offset: t, left: `${x}%`, top: `${y}%`, opacity: t < 0.05 || t > 0.95 ? 0 : 1, transform: `translate(-50%,-50%) rotate(${t * 540}deg) scale(${s})` };
  });
  el.animate(frames, { duration: 1000, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" });
}
