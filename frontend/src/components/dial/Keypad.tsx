import { useRef } from "react";

import { playKey } from "../../lib/dtmf";
import { KEY_LETTERS } from "../../lib/smartDial";
import { BackspaceIcon } from "../Icons";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0"] as const;

/** A phone keypad. Keys beep like a handset (if sound is on) and give a tiny buzz on phones that support it. */
export function Keypad({ onKey, onBackspace, onClear }: { onKey: (k: string) => void; onBackspace: () => void; onClear: () => void }) {
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buzz = () => navigator.vibrate?.(8);

  return (
    <div className="mx-auto grid max-w-[19rem] grid-cols-3 gap-2.5" role="group" aria-label="Keypad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => {
            playKey(k);
            buzz();
            onKey(k);
          }}
          className="group grid h-[3.8rem] place-items-center rounded-2xl border-[2.5px] border-edge bg-surface shadow-[3px_3px_0_var(--color-shadow)] transition duration-100 active:translate-x-[2px] active:translate-y-[2px] active:bg-saffron active:text-[#1c1712] active:shadow-none"
          aria-label={KEY_LETTERS[k] ? `${k} ${KEY_LETTERS[k].split("").join(" ")}` : k}
        >
          <span className="flex flex-col items-center leading-none">
            <span className="text-[1.75rem] font-extrabold" style={{ fontFamily: "var(--font-display)" }}>
              {k}
            </span>
            <span className="mt-0.5 h-3 text-[0.6rem] font-bold tracking-[0.18em] text-muted group-active:text-[#1c1712]">{KEY_LETTERS[k]}</span>
          </span>
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete the last character (hold to clear)"
        onClick={() => {
          playKey("back");
          buzz();
          onBackspace();
        }}
        onPointerDown={() => {
          hold.current = setTimeout(() => {
            hold.current = null;
            onClear();
          }, 650);
        }}
        onPointerUp={() => hold.current && clearTimeout(hold.current)}
        onPointerLeave={() => hold.current && clearTimeout(hold.current)}
        className="grid h-[3.8rem] place-items-center rounded-2xl border-[2.5px] border-edge bg-subtle text-ink shadow-[3px_3px_0_var(--color-shadow)] transition duration-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
      >
        <BackspaceIcon width={26} height={26} />
      </button>
    </div>
  );
}
