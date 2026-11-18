import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import "@fontsource/tiro-tamil/400.css";
import "@fontsource/tiro-devanagari-hindi/400.css";

import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../auth";

const FOOTNOTE =
  "AI translations and notes can contain mistakes. Calls are recorded only when every participant chooses “Record call”; recordings, meetings and transcripts are stored privately until you delete them.";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "What you get" },
  { href: "#privacy", label: "Privacy" },
];

/** Public-page frame: paper background, sticky header and a quiet footer. */
export function WarmShell({ children, nav = true }: { children: ReactNode; nav?: boolean }) {
  const { user } = useAuth();

  // Switch off the app's animated aurora background while a public page is on screen.
  useEffect(() => {
    document.body.classList.add("warm-body");
    return () => document.body.classList.remove("warm-body");
  }, []);

  return (
    <div className="warm flex flex-col">
      <a href="#main" className="sr-only z-[80] rounded-full border-2 border-chai bg-saffron px-4 py-2 font-bold focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b-[2.5px] border-chai bg-paper/95">
        <div className="mx-auto flex h-[4.25rem] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-2.5" aria-label="Asta Talk home">
            <img src="/favicon.svg" alt="" width={40} height={40} className="h-10 w-10 rounded-xl border-2 border-chai shadow-[2px_2px_0_var(--color-chai)] transition group-hover:-rotate-6" />
            <span className="wm-title text-[1.5rem] font-extrabold">Asta Talk</span>
          </Link>
          {nav && (
            <nav className="hidden items-center gap-7 text-[0.98rem] font-semibold md:flex" aria-label="Page sections">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className="underline-offset-[6px] decoration-2 decoration-chilli hover:underline">
                  {n.label}
                </a>
              ))}
            </nav>
          )}
          <div className="flex items-center gap-2.5 sm:gap-4">
            {user ? (
              <Link to="/start" className="wm-btn !min-h-11 !px-5 !py-2 !text-[0.98rem]">
                Open app
              </Link>
            ) : (
              <>
                <Link to="/login" className="hidden px-1 text-[0.98rem] font-semibold underline-offset-[6px] decoration-2 decoration-chilli hover:underline sm:inline">
                  Sign in
                </Link>
                <Link to="/login?next=/new" className="wm-btn !min-h-11 !px-4 !py-2 !text-[0.95rem] whitespace-nowrap sm:!px-5 sm:!text-[0.98rem]">
                  Start a call
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t-[2.5px] border-chai bg-paper-2">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[0.9rem] text-muted sm:px-6 md:flex-row md:items-start md:justify-between">
          <p className="max-w-2xl leading-relaxed">{FOOTNOTE}</p>
          <p className="wm-hand shrink-0 text-[1.1rem] text-chai">Tamil, Hindi and English, spoken live.</p>
        </div>
      </footer>
    </div>
  );
}
