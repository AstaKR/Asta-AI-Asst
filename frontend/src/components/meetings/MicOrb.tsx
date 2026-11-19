import { useEffect, useRef } from "react";

import { Star } from "../warm/Marquee";

/**
 * A "mic sun" that reacts to the real microphone level: the saffron core swells, a star of light behind it brightens
 * and dashed rings ripple outward as people talk. The level is written straight to the elements (no React re-render
 * per frame).
 */
export function MicOrb({ stream, paused = false }: { stream: MediaStream | null; paused?: boolean }) {
  const core = useRef<HTMLDivElement | null>(null);
  const glow = useRef<HTMLDivElement | null>(null);
  const rings = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!stream || paused) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let level = 0;
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const target = Math.min(1, Math.sqrt(sum / data.length) * 6);
      level += (target - level) * 0.25; // ease so it breathes instead of flickering
      const k = reduce ? 0 : level;
      if (core.current) core.current.style.transform = `scale(${1 + k * 0.28})`;
      if (glow.current) {
        glow.current.style.opacity = String(0.45 + k * 0.55);
        glow.current.style.transform = `scale(${1 + k * 0.18})`;
      }
      rings.current.forEach((r, i) => {
        if (!r) return;
        r.style.transform = `scale(${1 + k * (0.35 + i * 0.22)})`;
        r.style.opacity = String(Math.max(0, k * (0.9 - i * 0.28)));
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [stream, paused]);

  return (
    <div className="relative mx-auto grid aspect-square w-full max-w-[220px] place-items-center" aria-hidden="true">
      <div ref={glow} className="absolute inset-[-14%] opacity-50 transition-transform duration-75">
        <Star className="wm-spin-slow h-full w-full text-saffron/70" />
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          ref={(el) => {
            rings.current[i] = el;
          }}
          className="absolute inset-[14%] rounded-full border-2 border-dashed border-edge opacity-0"
        />
      ))}
      <div
        ref={core}
        className="relative grid h-[58%] w-[58%] place-items-center rounded-full border-[2.5px] border-edge bg-saffron shadow-[4px_4px_0_var(--color-shadow)] transition-transform duration-75"
      >
        <div className="flex h-1/3 items-center gap-[3px]">
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              style={{ animationDelay: `${(i * 0.11) % 1}s`, animationDuration: `${0.8 + ((i * 5) % 4) * 0.14}s` }}
              className={`h-full w-[3px] origin-center rounded-full bg-[#1c1712] ${paused ? "scale-y-[0.25]" : "animate-wave"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
