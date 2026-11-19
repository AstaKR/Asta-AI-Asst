import { LANGUAGE_NAMES, NATIVE_NAMES } from "../../lib/languages";
import { scriptFont } from "../call/TableArt";

const CODES = Object.keys(LANGUAGE_NAMES);
const ARC = 52; // degrees between positions on the dial
// Where each language label sits above the knob (% of the width and height): left, top, right.
const SPOTS = [
  { x: 22, y: 36 },
  { x: 50, y: 10 },
  { x: 77, y: 36 },
];

/**
 * A rotary language selector: the pointer swings to the language you pick, like a radio dial.
 * Tap a language, tap the knob to step to the next one, or use the arrow keys.
 */
export function LanguageKnob({ label, value, onChange }: { label: string; value: string; onChange: (code: string) => void }) {
  const index = Math.max(0, CODES.indexOf(value));
  const angle = (index - (CODES.length - 1) / 2) * ARC;
  const next = () => onChange(CODES[(index + 1) % CODES.length]);

  return (
    <div className="flex flex-col items-center">
      <p className="eyebrow mb-1">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="relative h-[7.6rem] w-[8.6rem]"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") onChange(CODES[(index + 1) % CODES.length]);
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") onChange(CODES[(index + CODES.length - 1) % CODES.length]);
        }}
      >
        {CODES.map((code, i) => {
          const { x, y } = SPOTS[i] ?? SPOTS[1];
          const on = code === value;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(code)}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-edge px-1.5 py-0.5 text-[0.8rem] leading-tight whitespace-nowrap transition duration-200 ${scriptFont(code)} ${
                on ? "scale-110 bg-saffron text-[#1c1712] shadow-[2px_2px_0_var(--color-shadow)]" : "bg-surface text-ink hover:-translate-y-[55%]"
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
              title={LANGUAGE_NAMES[code]}
            >
              {NATIVE_NAMES[code]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={next}
          tabIndex={-1}
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 grid h-[3.2rem] w-[3.2rem] -translate-x-1/2 place-items-center rounded-full border-[2.5px] border-edge bg-surface shadow-[3px_3px_0_var(--color-shadow)] active:translate-x-[calc(-50%+2px)] active:translate-y-0.5 active:shadow-none"
        >
          <span
            className="absolute inset-0 transition-transform duration-500 ease-[cubic-bezier(0.3,1.5,0.5,1)]"
            style={{ transform: `rotate(${angle}deg)` }}
          >
            <span className="absolute top-[3px] left-1/2 h-[1.05rem] w-[3px] -translate-x-1/2 rounded-full bg-[#b3301c]" />
          </span>
          <span className="h-2.5 w-2.5 rounded-full border-2 border-edge bg-saffron" />
        </button>
      </div>
    </div>
  );
}
