import { useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { useAuth } from "../auth";
import {
  ChartIcon,
  CloseIcon,
  ConversationIcon,
  GlobeIcon,
  HomeIcon,
  KeyIcon,
  KeypadIcon,
  LayersIcon,
  LogoutIcon,
  MeetingIcon,
  MenuIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
} from "./Icons";
import { IncomingCall } from "./IncomingCall";
import { WarmShell } from "./warm/WarmShell";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
const MAIN_NAV: { to: string; label: string; icon: Icon }[] = [
  { to: "/start", label: "Home", icon: HomeIcon },
  { to: "/dial", label: "Dial & contacts", icon: KeypadIcon },
  { to: "/translate", label: "Translate", icon: GlobeIcon },
  { to: "/face", label: "Face to face", icon: ConversationIcon },
  { to: "/meetings", label: "Meetings", icon: MeetingIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];
// The four everyday places, in the phone's bottom bar. Everything else lives behind "More".
const TABS: { to: string; label: string; icon: Icon }[] = [
  { to: "/start", label: "Home", icon: HomeIcon },
  { to: "/translate", label: "Translate", icon: GlobeIcon },
  { to: "/face", label: "Face", icon: ConversationIcon },
  { to: "/meetings", label: "Meetings", icon: MeetingIcon },
];
const ADMIN_NAV: { to: string; label: string; icon: Icon }[] = [
  { to: "/admin", label: "Dashboard", icon: ChartIcon },
  { to: "/admin/users", label: "Users", icon: UsersIcon },
  { to: "/admin/plans", label: "Plans", icon: LayersIcon },
  { to: "/admin/keys", label: "API keys", icon: KeyIcon },
];

export function Brand() {
  return (
    <Link to="/" className="group flex items-center gap-2.5 text-ink" aria-label="Asta Talk home">
      <img
        src="/favicon.svg"
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 rounded-xl border-2 border-edge shadow-[2px_2px_0_var(--color-shadow)] transition group-hover:-rotate-6"
      />
      <span className="page-title text-[1.35rem]">Asta Talk</span>
    </Link>
  );
}

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* storage unavailable: theme lasts for this page only */
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => {
        const next: Theme = dark ? "light" : "dark";
        applyTheme(next);
        setTheme(next);
      }}
      className="btn-ghost !min-h-9 h-9 w-9 !p-0"
      aria-label={dark ? "Switch to light theme" : "Switch to night theme"}
      title={dark ? "Light theme" : "Night theme"}
    >
      {dark ? <SunIcon width={18} height={18} /> : <MoonIcon width={18} height={18} />}
    </button>
  );
}

function NavItem({ to, label, icon: I, onNavigate }: { to: string; label: string; icon: Icon; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === "/admin"}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-2xl border-2 px-3 py-2 text-[0.95rem] font-bold transition duration-150 ${
          isActive
            ? "-rotate-1 border-edge bg-saffron text-[#1c1712] shadow-[3px_3px_0_var(--color-shadow)]"
            : "border-transparent text-ink hover:translate-x-1 hover:bg-subtle"
        }`
      }
    >
      <I width={19} height={19} />
      {label}
    </NavLink>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const name = user?.preferences.display_name || user?.phone_number || user?.username || "";
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center justify-between px-1 pt-1">
        <Brand />
      </div>
      <nav className="flex flex-col gap-1.5" aria-label="Main">
        {MAIN_NAV.map((n) => (
          <NavItem key={n.to} {...n} onNavigate={onNavigate} />
        ))}
      </nav>
      {user?.is_staff && (
        <nav className="flex flex-col gap-1.5" aria-label="Admin">
          <p className="eyebrow px-3 pb-1">Admin</p>
          {ADMIN_NAV.map((n) => (
            <NavItem key={n.to} {...n} onNavigate={onNavigate} />
          ))}
        </nav>
      )}
      <div className="mt-auto flex items-center gap-2.5 rounded-2xl border-2 border-edge bg-surface p-2.5 shadow-[3px_3px_0_var(--color-shadow)]">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-edge bg-saffron text-lg font-extrabold text-[#1c1712]"
          style={{ fontFamily: "var(--font-display)" }}
          aria-hidden="true"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-bold text-ink">{name}</p>
          <p className="text-xs text-muted">{user?.is_staff ? "Administrator" : "Member"}</p>
        </div>
        <ThemeToggle />
        <button onClick={() => void logout()} className="btn-ghost !min-h-9 h-9 w-9 !p-0" aria-label="Sign out" title="Sign out">
          <LogoutIcon width={18} height={18} />
        </button>
      </div>
    </div>
  );
}

/** Phone bottom bar: a saffron sticker slides to the tab you are on. */
function TabBar({ onMore }: { onMore: () => void }) {
  const location = useLocation();
  const index = TABS.findIndex((t) => location.pathname === t.to || location.pathname.startsWith(t.to + "/"));
  const slots = TABS.length + 1;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t-[2.5px] border-edge bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
      <div className="relative mx-auto grid max-w-lg px-1.5 py-1.5" style={{ gridTemplateColumns: `repeat(${slots}, 1fr)` }}>
        {index >= 0 && (
          <span
            className="pointer-events-none absolute top-1.5 bottom-1.5 rounded-2xl border-2 border-edge bg-saffron shadow-[2px_2px_0_var(--color-shadow)] transition-[left] duration-300 ease-[cubic-bezier(0.3,1.4,0.5,1)]"
            style={{ left: `calc(6px + (100% - 12px) / ${slots} * ${index} + 3px)`, width: `calc((100% - 12px) / ${slots} - 6px)` }}
            aria-hidden="true"
          />
        )}
        {TABS.map(({ to, label, icon: I }, i) => (
          <NavLink key={to} to={to} className={`relative z-10 flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[0.7rem] font-bold ${i === index ? "text-[#1c1712]" : "text-muted"}`}>
            <I width={21} height={21} />
            {label}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} className="relative z-10 flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[0.7rem] font-bold text-muted" aria-label="More">
          <MenuIcon width={21} height={21} />
          More
        </button>
      </div>
    </nav>
  );
}

const FOOTNOTE =
  "AI translations and notes can contain mistakes. Calls are recorded only when every participant chooses “Record call”; recordings, meetings and transcripts are stored privately until you delete them.";

export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [location.pathname]);
  // Each screen starts at the top, and keyboard users land on its content.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (!user) return <WarmShell>{<div className={`mx-auto w-full px-4 py-10 sm:px-6 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</div>}</WarmShell>;

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[272px_1fr]">
      <IncomingCall />
      <aside className="sticky top-0 hidden h-screen border-r-[2.5px] border-edge bg-subtle lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-[#1c1712]/50" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-rise border-r-[2.5px] border-edge bg-canvas">
            <button className="btn-ghost absolute top-4 right-3 !min-h-9 h-9 w-9 !p-0" onClick={() => setOpen(false)} aria-label="Close menu">
              <CloseIcon width={18} height={18} />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-h-full min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b-[2.5px] border-edge bg-canvas px-4 lg:hidden">
          <Brand />
          <ThemeToggle />
        </header>
        <main ref={main} className={`mx-auto w-full flex-1 px-4 pt-6 pb-28 sm:px-8 sm:pt-10 lg:pb-10 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
          {children}
        </main>
        <footer className="border-t-2 border-line px-4 py-5 pb-28 text-center text-xs text-muted sm:px-8 lg:pb-5">{FOOTNOTE}</footer>
      </div>
      <TabBar onMore={() => setOpen(true)} />
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="page-title text-[clamp(2rem,5vw,2.9rem)]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[0.98rem] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-2xl border-2 border-danger bg-danger-soft px-4 py-3 text-sm font-semibold text-danger shadow-[3px_3px_0_var(--color-danger)]"
    >
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="font-bold" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
