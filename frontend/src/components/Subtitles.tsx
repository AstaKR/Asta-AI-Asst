import { useEffect, useRef } from "react";

import { languageName } from "../lib/languages";
import type { TranslatorState } from "../lib/translatorEvents";

interface Props {
  state: TranslatorState;
  myIdentity: string;
  nameOf: (identity: string) => string;
  partialEnabled?: boolean;
}

export function Subtitles({ state, myIdentity, nameOf, partialEnabled = true }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [state.lines.length, state.partialBySpeaker]);

  const partials = partialEnabled ? Object.entries(state.partialBySpeaker) : [];

  return (
    <section className="card flex min-h-[320px] flex-col" aria-label="Live subtitles">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">Live subtitles</h2>
        <span className="text-xs text-muted">Not saved</span>
      </div>
      <div className="max-h-[55vh] flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {state.lines.length === 0 && partials.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">Subtitles appear here when someone speaks.</p>
        )}
        {state.lines.map((line) => {
          const mine = line.speaker === myIdentity;
          // For the other person, the translation (into my language) is the main text; for me, my own words are.
          const main = mine ? line.original : line.translation ?? line.original;
          const secondary = mine ? line.translation : line.translation ? line.original : undefined;
          const secondaryLang = mine ? line.translationLanguage : line.originalLanguage;
          return (
            <div key={line.id} className={`flex ${mine ? "justify-end" : ""}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-2.5 ${mine ? "bg-brand text-white" : "bg-subtle text-ink"} ${
                  line.skipped ? "opacity-50" : ""
                }`}
              >
                <div className={`text-[11px] font-semibold uppercase tracking-wide ${mine ? "text-indigo-200" : "text-muted"}`}>
                  {nameOf(line.speaker)}
                  {line.skipped && " · skipped (newer speech)"}
                  {!line.translation && !line.skipped && " · translating…"}
                </div>
                <div className="mt-0.5 text-[15px] leading-relaxed">{main}</div>
                {secondary && (
                  <div className={`mt-1.5 border-t pt-1.5 text-sm ${mine ? "border-white/20 text-indigo-100" : "border-line text-muted"}`}>
                    <span className="mr-1 text-[11px] font-semibold uppercase">{languageName(secondaryLang)}:</span>
                    {secondary}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {partials.map(([speaker, text]) => (
          <div key={`partial-${speaker}`} className={`flex ${speaker === myIdentity ? "justify-end" : ""}`}>
            <div className="max-w-[88%] rounded-2xl border border-dashed border-line px-4 py-2 text-sm italic text-muted">
              {nameOf(speaker)}: {text}…
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
