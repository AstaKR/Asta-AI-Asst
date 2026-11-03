import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { useAuth } from "../auth";
import { ChartIcon, CloseIcon, GlobeIcon, KeyIcon, LayersIcon, LogoutIcon, MeetingIcon, MenuIcon, MoonIcon, PhoneIcon, SettingsIcon, SunIcon, UsersIcon } from "./Icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
const MAIN_NAV: { to: string; label: string; icon: Icon }[] = [
  { to: "/start", label: "Calls", icon: PhoneIcon },
  { to: "/translate", label: "Translate", icon: GlobeIcon },
  { to: "/meetings", label: "Meetings", icon: MeetingIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];
const ADMIN_NAV: { to: string; label: string; icon: Icon }[] = [
  { to: "/admin", label: "Dashboard", icon: ChartIcon },
  { to: "/admin/users", label: "Users", icon: UsersIcon },
  { to: "/admin/plans", label: "Plans", icon: LayersIcon },
  { to: "/admin/keys", label: "API keys", icon: KeyIcon },
];

export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-ink">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
        <GlobeIcon width={18} height={18} />
      </span>
      <span>AI Call Translator</span>
    </Link>
  );
}

type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable: theme lasts for this page only */
    }
  }, [theme]);
  const dark = theme === "dark" || (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="btn-ghost h-9 w-9 p-0"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
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
        `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? "bg-brand-soft text-brand" : "text-muted hover:bg-subtle hover:text-ink"
        }`
      }
    >
      <I width={18} height={18} />
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
      <nav className="flex flex-col gap-1" aria-label="Main">
        {MAIN_NAV.map((n) => (
          <NavItem key={n.to} {...n} onNavigate={onNavigate} />
        ))}
      </nav>
      {user?.is_staff && (
        <nav className="flex flex-col gap-1" aria-label="Admin">
          <p className="eyebrow px-3 pb-1">Admin</p>
          {ADMIN_NAV.map((n) => (
            <NavItem key={n.to} {...n} onNavigate={onNavigate} />
          ))}
        </nav>
      )}
      <div className="mt-auto flex items-center gap-3 rounded-xl border border-line p-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          <p className="text-xs text-muted">{user?.is_staff ? "Administrator" : "Member"}</p>
        </div>
        <ThemeToggle />
        <button onClick={() => void logout()} className="btn-ghost h-9 w-9 p-0" aria-label="Sign out" title="Sign out">
          <LogoutIcon width={18} height={18} />
        </button>
      </div>
    </div>
  );
}

const FOOTNOTE =
  "AI translations and notes can contain mistakes. Calls are not recorded unless every participant chooses “Save transcript”; meetings you record or upload are stored privately until you delete them.";

export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  if (!user) {
    return (
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Brand />
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link to="/login" className="btn-primary">
                Sign in
              </Link>
            </div>
          </div>
        </header>
        <main className={`mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</main>
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-muted">{FOOTNOTE}</footer>
      </div>
    );
  }

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-xl">
            <button className="btn-ghost absolute top-4 right-3 h-9 w-9 p-0" onClick={() => setOpen(false)} aria-label="Close menu">
              <CloseIcon width={18} height={18} />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-h-full min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur lg:hidden">
          <button className="btn-ghost h-9 w-9 p-0" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon width={20} height={20} />
          </button>
          <Brand />
        </header>
        <main className={`mx-auto w-full flex-1 px-4 py-6 sm:px-8 sm:py-10 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</main>
        <footer className="border-t border-line px-4 py-5 text-center text-xs text-muted sm:px-8">{FOOTNOTE}</footer>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="font-semibold" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
