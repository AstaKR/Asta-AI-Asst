import type { ReactNode } from "react";

/** A chunky on/off switch with a title and a line of explanation. */
export function Switch({ checked, onChange, title, children, icon }: { checked: boolean; onChange: (v: boolean) => void; title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <label className="group/sw flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-edge bg-surface p-3.5 transition hover:-translate-y-0.5">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-edge bg-subtle">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
        {children && <span className="block text-[0.88rem] leading-snug text-muted">{children}</span>}
      </span>
      <span
        aria-hidden="true"
        className="relative h-8 w-14 shrink-0 rounded-full border-2 border-edge bg-subtle transition-colors group-has-checked/sw:bg-saffron group-has-focus-visible/sw:outline-[2.5px] group-has-focus-visible/sw:outline-offset-4 group-has-focus-visible/sw:outline-brand"
      >
        <span className="absolute top-[3px] left-[3px] h-5 w-5 rounded-full border-2 border-edge bg-surface transition-transform duration-300 ease-[cubic-bezier(0.3,1.5,0.5,1)] group-has-checked/sw:translate-x-6" />
      </span>
    </label>
  );
}
