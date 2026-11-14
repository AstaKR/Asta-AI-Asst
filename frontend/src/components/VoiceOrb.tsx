import type { CSSProperties } from "react";

const BARS = 28;

/** Animated "voice core": rotating rings, a glowing core and a live-looking waveform. Pure CSS/SVG, decorative. */
export function VoiceOrb({ className = "" }: { className?: string }) {
  return (
    <div className={`relative mx-auto aspect-square w-full max-w-[460px] ${className}`} aria-hidden="true">
      <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle,rgb(138_123_255/0.55),rgb(39_227_255/0.18)_55%,transparent_72%)] blur-2xl" />
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full animate-spin-slow">
        <defs>
          <linearGradient id="orb-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-brand)" />
            <stop offset="1" stopColor="var(--color-neon)" />
          </linearGradient>
        </defs>
        <circle cx="200" cy="200" r="186" fill="none" stroke="url(#orb-a)" strokeWidth="1.2" strokeDasharray="2 9" opacity="0.8" />
        <circle cx="200" cy="200" r="160" fill="none" stroke="url(#orb-a)" strokeWidth="1" strokeDasharray="60 14 6 14" opacity="0.5" />
        <circle cx="200" cy="14" r="5" fill="var(--color-neon)" />
        <circle cx="386" cy="200" r="3.5" fill="var(--color-pink)" />
      </svg>
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full animate-spin-slower">
        <circle cx="200" cy="200" r="128" fill="none" stroke="var(--color-brand)" strokeWidth="1" strokeDasharray="4 6" opacity="0.7" />
        <circle cx="72" cy="200" r="4" fill="var(--color-accent)" />
        <circle cx="200" cy="328" r="3" fill="var(--color-brand)" />
      </svg>
      <div className="absolute inset-[27%] grid place-items-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_30%_25%,rgb(255_255_255/0.22),rgb(138_123_255/0.35)_40%,rgb(6_8_30/0.9)_80%)] shadow-[0_0_80px_-6px_rgb(138_123_255/0.8),inset_0_0_40px_rgb(39_227_255/0.25)] backdrop-blur-xl">
        <div className="flex h-1/3 items-center gap-[3px]">
          {Array.from({ length: BARS }, (_, i) => {
            const style: CSSProperties = {
              animationDelay: `${(i * 0.09) % 1.3}s`,
              animationDuration: `${0.9 + ((i * 7) % 5) * 0.12}s`,
            };
            return <span key={i} style={style} className="animate-wave h-full w-[3px] origin-center rounded-full bg-gradient-to-b from-neon to-brand" />;
          })}
        </div>
      </div>
      {[
        { t: "தமிழ்", s: "left-[2%] top-[18%]" },
        { t: "हिन्दी", s: "right-[0%] top-[34%]" },
        { t: "English", s: "left-[14%] bottom-[8%]" },
      ].map((c, i) => (
        <span
          key={c.t}
          style={{ animationDelay: `${i * 1.4}s` }}
          className={`animate-float absolute ${c.s} rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink shadow-(--shadow-card) backdrop-blur-xl`}
        >
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
          {c.t}
        </span>
      ))}
    </div>
  );
}
