import { useEffect, useState } from "react";

import type { LanguageSelection } from "../api";
import { LANGUAGE_NAMES, NATIVE_NAMES } from "../lib/languages";
import { scriptFont } from "./call/TableArt";
import { CheckIcon } from "./Icons";

const VOICES = ["shubh", "aditya", "rahul", "rohan", "amit", "ritu", "priya", "neha", "pooja", "kavya"];

interface Props {
  value: LanguageSelection;
  onChange: (v: LanguageSelection) => void;
  showVoice?: boolean;
}

export function LanguagePicker({ value, onChange, showVoice = true }: Props) {
  const [split, setSplit] = useState(value.spoken_language !== value.listen_language);
  useEffect(() => {
    if (value.spoken_language !== value.listen_language) setSplit(true);
  }, [value.spoken_language, value.listen_language]);

  const codes = Object.keys(LANGUAGE_NAMES);
  return (
    <div className="space-y-5">
      {!split ? (
        <fieldset>
          <legend className="label">Your language</legend>
          <p className="mb-3 text-sm text-muted">You will speak in this language and hear the other person translated into it.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {codes.map((code) => {
              const active = value.spoken_language === code;
              return (
                <button
                  type="button"
                  key={code}
                  aria-pressed={active}
                  onClick={() => onChange({ ...value, spoken_language: code, listen_language: code })}
                  className={`relative rounded-2xl border-[2.5px] border-edge px-4 py-3 text-left transition duration-200 ${
                    active ? "-rotate-1 bg-saffron text-[#1c1712] shadow-[4px_4px_0_var(--color-shadow)]" : "bg-surface hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--color-shadow)]"
                  }`}
                >
                  <div className={`text-[1.55rem] leading-tight ${scriptFont(code)}`}>{NATIVE_NAMES[code]}</div>
                  <div className={`text-xs font-semibold ${active ? "" : "text-muted"}`}>{LANGUAGE_NAMES[code]}</div>
                  {active && (
                    <span className="wm-pop absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full border-2 border-edge bg-[#1c1712] text-saffron" aria-hidden="true">
                      <CheckIcon width={14} height={14} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">I will speak</span>
            <select className="field" value={value.spoken_language} onChange={(e) => onChange({ ...value, spoken_language: e.target.value })}>
              {codes.map((c) => (
                <option key={c} value={c}>
                  {LANGUAGE_NAMES[c]} · {NATIVE_NAMES[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">I want to hear</span>
            <select className="field" value={value.listen_language} onChange={(e) => onChange({ ...value, listen_language: e.target.value })}>
              {codes.map((c) => (
                <option key={c} value={c}>
                  {LANGUAGE_NAMES[c]} · {NATIVE_NAMES[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <button
        type="button"
        className="text-sm font-bold text-brand underline decoration-2 underline-offset-4 hover:decoration-saffron"
        onClick={() => {
          if (split) onChange({ ...value, listen_language: value.spoken_language });
          setSplit(!split);
        }}
      >
        {split ? "Use one language for speaking and listening" : "Speak and hear different languages"}
      </button>
      {showVoice && (
        <label className="block">
          <span className="label">Your translated voice</span>
          <select className="field" value={value.voice ?? ""} onChange={(e) => onChange({ ...value, voice: e.target.value })}>
            <option value="">Default</option>
            {VOICES.map((v) => (
              <option key={v} value={v}>
                {v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-xs text-muted">The other person hears your words in this synthetic voice.</span>
        </label>
      )}
    </div>
  );
}
