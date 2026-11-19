import { useEffect, useRef } from "react";

import { languageName } from "../lib/languages";
import type { TranslatorState } from "../lib/translatorEvents";
import { scriptFont } from "./call/TableArt";

interface Props {
  state: TranslatorState;
  myIdentity: string;
  nameOf: (identity: string) => string;
  partialEnabled?: boolean;
}

/** Live subtitles as paper strips: yours in saffron on the right, theirs on the left, each in its own script. */
export function Subtitles({ state, myIdentity, nameOf, partialEnabled = true }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [state.lines.length, state.partialBySpeaker]);

  const partials = partialEnabled ? Object.entries(state.partialBySpeaker) : [];

  return (
    <section className="card flex min-h-[320px] flex-col lg:min-h-[56vh]" aria-label="Live subtitles">
      <div className="flex items-center justify-between border-b-2 border-line px-5 py-3">
        <h2 className="page-title text-[1.35rem]">Live subtitles</h2>
        <span className="sticker !py-0.5">Not saved</span>
      </div>
      <div className="max-h-[60vh] flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite">
        {state.lines.length === 0 && partials.length === 0 && (
          <p className="wm-hand py-12 text-center text-[1.15rem] text-muted">Subtitles appear here when someone speaks.</p>
        )}
        {state.lines.map((line) => {
          const mine = line.speaker === myIdentity;
          // For the other person, the translation (into my language) is the main text; for me, my own words are.
          const main = mine ? line.original : line.translation ?? line.original;
          const mainLang = mine ? line.originalLanguage : line.translation ? line.translationLanguage : line.originalLanguage;
          const secondary = mine ? line.translation : line.translation ? line.original : undefined;
          const secondaryLang = mine ? line.translationLanguage : line.originalLanguage;
          return (
            <div key={line.id} className={`wm-pop flex ${mine ? "justify-end" : ""}`}>
              <div
                className={`max-w-[90%] rounded-2xl border-2 border-edge px-4 py-2.5 shadow-[3px_3px_0_var(--color-shadow)] ${mine ? "rotate-[0.4deg] bg-saffron text-[#1c1712]" : "-rotate-[0.4deg] bg-surface text-ink"} ${
                  line.skipped ? "opacity-50" : ""
                }`}
              >
                <div className={`text-[0.7rem] font-extrabold tracking-wider uppercase ${mine ? "text-[#1c1712]/75" : "text-muted"}`}>
                  {nameOf(line.speaker)}
                  {line.skipped && " · skipped (newer speech)"}
                  {!line.translation && !line.skipped && " · translating…"}
                </div>
                <div className={`mt-0.5 text-[1.2rem] leading-relaxed ${scriptFont(mainLang)}`}>{main}</div>
                {secondary && (
                  <div className={`mt-1.5 border-t-2 border-dashed pt-1.5 text-[0.95rem] ${mine ? "border-[#1c1712]/40 text-[#1c1712]/85" : "border-line text-muted"}`}>
                    <span className="mr-1.5 text-[0.7rem] font-extrabold uppercase">{languageName(secondaryLang)}</span>
                    <span className={scriptFont(secondaryLang)}>{secondary}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {partials.map(([speaker, text]) => (
          <div key={`partial-${speaker}`} className={`flex ${speaker === myIdentity ? "justify-end" : ""}`}>
            <div className="max-w-[90%] rounded-2xl border-2 border-dashed border-edge/60 px-4 py-2 text-[0.95rem] text-muted italic">
              {nameOf(speaker)}: {text}
              <span className="wm-caret" aria-hidden="true" />
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}
