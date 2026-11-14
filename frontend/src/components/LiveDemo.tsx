import { useEffect, useState } from "react";

interface Turn {
  from: string;
  to: string;
  text: string;
  out: string;
}

const TURNS: Turn[] = [
  { from: "தமிழ்", to: "हिन्दी", text: "வணக்கம், இன்று கூட்டம் எத்தனை மணிக்கு?", out: "नमस्ते, आज मीटिंग कितने बजे है?" },
  { from: "हिन्दी", to: "தமிழ்", text: "चार बजे, मैं लिंक भेज दूँगा।", out: "நான்கு மணிக்கு, நான் இணைப்பை அனுப்புகிறேன்." },
  { from: "English", to: "தமிழ்", text: "Can you hear me clearly?", out: "என் குரல் தெளிவாகக் கேட்கிறதா?" },
  { from: "हिन्दी", to: "English", text: "रिपोर्ट कल सुबह तक भेज दूँगा।", out: "I will send the report by tomorrow morning." },
];

/** Typewriter loop of live-translation turns; shows what a call feels like. Decorative. */
export function LiveDemo() {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [showOut, setShowOut] = useState(false);
  const turn = TURNS[index];

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setTyped(turn.text.length);
      setShowOut(true);
      return;
    }
    setTyped(0);
    setShowOut(false);
    let n = 0;
    const type = window.setInterval(() => {
      n += 1;
      setTyped(n);
      if (n >= turn.text.length) window.clearInterval(type);
    }, 38);
    const reveal = window.setTimeout(() => setShowOut(true), turn.text.length * 38 + 450);
    const next = window.setTimeout(() => setIndex((i) => (i + 1) % TURNS.length), turn.text.length * 38 + 4200);
    return () => {
      window.clearInterval(type);
      window.clearTimeout(reveal);
      window.clearTimeout(next);
    };
  }, [index, turn.text.length]);

  return (
    <div className="card glow-border hud p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Live translation</p>
        <span className="chip bg-accent-soft font-mono text-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          streaming
        </span>
      </div>
      <div className="mt-5 min-h-[168px] space-y-3">
        <div className="rounded-2xl bg-subtle px-4 py-3">
          <p className="font-mono text-[10px] tracking-[0.2em] text-muted uppercase">{turn.from} · speaking</p>
          <p className="mt-1 text-[17px] leading-snug">
            {turn.text.slice(0, typed)}
            <span className="animate-blink ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] bg-neon" />
          </p>
        </div>
        <div
          className={`rounded-2xl border border-brand/40 bg-gradient-to-br from-brand-soft to-neon-soft px-4 py-3 transition-all duration-500 ${
            showOut ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          }`}
        >
          <p className="font-mono text-[10px] tracking-[0.2em] text-neon uppercase">{turn.to} · heard</p>
          <p className="mt-1 text-[17px] leading-snug text-ink">{turn.out}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-muted">
        <span>latency ≈ 2.5 s</span>
        <span>ta ↔ hi ↔ en</span>
      </div>
    </div>
  );
}
