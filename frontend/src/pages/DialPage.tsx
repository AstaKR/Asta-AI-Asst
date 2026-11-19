import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError, api, contactsApi, directApi, phoneApi, type LanguageSelection } from "../api";
import { useAuth } from "../auth";
import { scriptFont } from "../components/call/TableArt";
import { ContactForm, type ContactDraft } from "../components/dial/ContactForm";
import { Keypad } from "../components/dial/Keypad";
import { LanguageKnob } from "../components/dial/LanguageKnob";
import { CameraIcon, ClockIcon, KeypadIcon, PencilIcon, PhoneIcon, SearchIcon, StarIcon, SwapIcon, UserPlusIcon, UsersIcon } from "../components/Icons";
import { ErrorBanner, Layout, PageHeader } from "../components/Layout";
import { setSound, soundOn } from "../lib/dtmf";
import { NATIVE_NAMES } from "../lib/languages";
import { avatarColor, initialOf, matchContacts } from "../lib/smartDial";
import type { Contact, DirectCall, PhoneCall, PhoneConfig } from "../types";

type Tab = "keypad" | "contacts" | "recent";
type Line = "app" | "phone";
const CALLER_LANGUAGES = ["", "ta-IN", "hi-IN", "en-IN"]; // "" = detect from their speech
const PHONE_STATUS: Record<PhoneCall["status"], string> = { ringing: "Ringing", answered: "In call", missed: "Missed", declined: "Declined", failed: "Failed", ended: "Ended" };
const TABS: { key: Tab; label: string; icon: typeof KeypadIcon }[] = [
  { key: "keypad", label: "Keypad", icon: KeypadIcon },
  { key: "contacts", label: "Contacts", icon: UsersIcon },
  { key: "recent", label: "Recent", icon: ClockIcon },
];

const STATUS: Record<DirectCall["status"], string> = {
  ringing: "Ringing",
  answered: "Answered",
  declined: "Declined",
  missed: "Missed",
  cancelled: "Cancelled",
  ended: "Ended",
};

function Avatar({ name, seed, size = "h-11 w-11 text-lg" }: { name: string; seed: string; size?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full border-2 border-edge font-extrabold text-[#1c1712] ${avatarColor(seed)} ${size}`} style={{ fontFamily: "var(--font-display)" }} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

/** "தமிழ் → हिन्दी": what you speak, then what you hear. */
function Route({ spoken, listen }: { spoken: string; listen: string }) {
  return (
    <span className="sticker !bg-surface !py-0 text-[0.9rem] !text-ink">
      <span className={scriptFont(spoken)}>{NATIVE_NAMES[spoken] ?? spoken}</span>
      {spoken !== listen && (
        <>
          <span aria-hidden="true" className="text-neon">→</span>
          <span className={scriptFont(listen)}>{NATIVE_NAMES[listen] ?? listen}</span>
        </>
      )}
    </span>
  );
}

function RoundButton({ label, onClick, disabled, children, primary }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; primary?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`grid place-items-center rounded-full border-[2.5px] border-edge shadow-[3px_3px_0_var(--color-shadow)] transition duration-100 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-45 ${
          primary ? "h-[4.6rem] w-[4.6rem] bg-saffron text-[#1c1712]" : "h-14 w-14 bg-surface text-ink"
        } ${primary && !disabled ? "animate-pulse-ring" : ""}`}
      >
        {children}
      </button>
      <span className="text-xs font-bold">{label}</span>
    </div>
  );
}

/** Dial a person on Asta Talk: a keypad with smart contact matching, a phonebook, and recent calls. Calls are free. */
export function DialPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS.find((t) => t.key === params.get("tab"))?.key ?? "keypad") as Tab;
  const prefs = user?.preferences;

  const [to, setTo] = useState("");
  const [sel, setSel] = useState<LanguageSelection>({
    spoken_language: prefs?.spoken_language ?? "ta-IN",
    listen_language: prefs?.listen_language ?? "ta-IN",
    voice: prefs?.voice ?? "",
  });
  const [picked, setPicked] = useState<Contact | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [history, setHistory] = useState<DirectCall[]>([]);
  const [form, setForm] = useState<null | { contact?: Contact; draft?: ContactDraft }>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sound, setSoundOn] = useState(soundOn);
  const [typing, setTyping] = useState(false);
  const [line, setLine] = useState<Line>("app");
  const [callerLanguage, setCallerLanguage] = useState("");
  const [phoneConfig, setPhoneConfig] = useState<PhoneConfig | null>(null);
  const [phoneHistory, setPhoneHistory] = useState<PhoneCall[]>([]);

  const loadContacts = useCallback(() => contactsApi.list().then(setContacts).catch(() => undefined), []);
  useEffect(() => {
    void loadContacts();
    directApi.list().then(setHistory).catch(() => undefined);
    phoneApi.config().then(setPhoneConfig).catch(() => undefined);
    phoneApi.calls().then(setPhoneHistory).catch(() => undefined);
  }, [loadContacts]);

  const goTab = (t: Tab) => setParams(t === "keypad" ? {} : { tab: t }, { replace: true });
  const suggestions = useMemo(() => (picked || line === "phone" ? [] : matchContacts(contacts, to)), [contacts, to, picked, line]);
  const known = useMemo(() => new Set(contacts.flatMap((c) => [c.username.toLowerCase(), c.target.toLowerCase()])), [contacts]);

  function edit(value: string) {
    setTo(value.slice(0, 40));
    if (picked && value !== picked.target) setPicked(null);
  }

  function pick(c: Contact) {
    setLine("app");
    setPicked(c);
    setTo(c.target);
    setSel({ spoken_language: c.spoken_language, listen_language: c.listen_language, voice: c.voice });
    setError("");
    goTab("keypad");
  }

  async function place(target: string, langs: LanguageSelection, video: boolean, remember = false) {
    if (!target.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await directApi.call({ to: target.trim(), ...langs, video });
      if (remember) void api.savePreferences({ spoken_language: langs.spoken_language, listen_language: langs.listen_language });
      navigate(`/call/${res.room_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the call");
      setBusy(false);
    }
  }

  /** Ring a normal phone number; the server bridges it into a translated call room. */
  async function placePhone() {
    setBusy(true);
    setError("");
    try {
      const res = await phoneApi.dial({ number: to, spoken_language: sel.spoken_language, listen_language: sel.spoken_language, caller_language: callerLanguage });
      void api.savePreferences({ spoken_language: sel.spoken_language, listen_language: sel.listen_language });
      navigate(`/call/${res.room_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the call");
      setBusy(false);
    }
  }

  const phoneReady = phoneConfig?.dial_enabled ?? false;
  const phoneDigits = to.replace(/\D/g, "").length;
  const callTyped = (video: boolean) => (line === "phone" ? void placePhone() : void place(to, sel, video, !picked));
  const callContact = (c: Contact, video: boolean) => void place(c.target, { spoken_language: c.spoken_language, listen_language: c.listen_language, voice: c.voice }, video);

  async function rememberFor(c: Contact) {
    try {
      const saved = await contactsApi.update(c.id, { spoken_language: sel.spoken_language, listen_language: sel.listen_language, voice: sel.voice ?? "" });
      setPicked(saved);
      void loadContacts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    }
  }

  const changed = picked && (sel.spoken_language !== picked.spoken_language || sel.listen_language !== picked.listen_language || (sel.voice ?? "") !== picked.voice);
  const canSave = to.trim() && !picked && !known.has(to.trim().toLowerCase().replace(/^@/, ""));

  function openNew(draft?: ContactDraft) {
    setForm({ draft });
    goTab("contacts");
  }

  /* ---------------- keypad ---------------- */
  const keypad = (
    <div className="card mx-auto w-full max-w-[24rem] space-y-5 p-5">
      <div className="grid grid-cols-2 gap-1 rounded-full border-2 border-edge bg-subtle p-1" role="tablist" aria-label="Who are you calling">
        {(["app", "phone"] as Line[]).map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={line === l}
            onClick={() => {
              setLine(l);
              setPicked(null);
              setError("");
            }}
            className={`rounded-full px-2 py-1.5 text-sm font-bold transition ${line === l ? "border-2 border-edge bg-surface" : "text-muted hover:text-ink"}`}
          >
            {l === "app" ? "On Asta Talk (free)" : "Normal phone"}
          </button>
        ))}
      </div>
      {line === "phone" && phoneConfig && !phoneReady && (
        <p role="status" className="rounded-2xl border-2 border-warn bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
          Calling normal phone numbers is not set up yet: it needs a paid phone line on the server. Use “On Asta Talk” to call people who have the app, free.
        </p>
      )}
      <div className="rounded-3xl border-[2.5px] border-edge bg-butter p-3.5 text-[#1c1712] shadow-[4px_4px_0_var(--color-shadow)]">
        <div className="flex items-center justify-between text-[0.7rem] font-extrabold tracking-[0.16em] uppercase">
          <span>{picked ? "Calling" : line === "phone" ? "Phone number" : "Dialling"}</span>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                setSound(!sound);
                setSoundOn(!sound);
              }}
              aria-pressed={sound}
              className="rounded-full border-2 border-edge px-2 py-0.5 hover:bg-[#1c1712]/10"
              title="Key sounds"
            >
              {sound ? "Sound on" : "Sound off"}
            </button>
            <button type="button" hidden={line === "phone"} onClick={() => setTyping(!typing)} aria-pressed={typing} className="rounded-full border-2 border-edge px-2 py-0.5 hover:bg-[#1c1712]/10" title="Use the on-screen keyboard to type a username">
              {typing ? "Keypad only" : "Type a name"}
            </button>
          </span>
        </div>
        {picked && (
          <div className="wm-pop mt-2 flex items-center gap-2.5">
            <Avatar name={picked.name} seed={picked.username} size="h-9 w-9 text-base" />
            <span className="min-w-0 flex-1 truncate font-bold">{picked.name}</span>
            <Route spoken={picked.spoken_language} listen={picked.listen_language} />
          </div>
        )}
        <input
          value={to}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && callTyped(false)}
          inputMode={line === "phone" ? "tel" : typing ? "text" : "none"}
          autoComplete="off"
          spellCheck={false}
          aria-label={line === "phone" ? "Phone number" : "Username or mobile number"}
          placeholder={line === "phone" ? "+91 98765 43210" : "name or number"}
          className="mt-1 w-full bg-transparent text-center font-mono text-[2rem] leading-tight tracking-wide text-[#1c1712] outline-none placeholder:font-hand placeholder:text-[1.35rem] placeholder:tracking-normal placeholder:text-[#1c1712]/55"
        />
        <div className="flex min-h-[2.4rem] flex-wrap justify-center gap-1.5" aria-live="polite">
          {suggestions.map((c) => (
            <button key={c.id} type="button" onClick={() => pick(c)} className="wm-pop inline-flex items-center gap-1.5 rounded-full border-2 border-edge bg-surface py-0.5 pr-2.5 pl-0.5 text-sm font-bold text-ink hover:-translate-y-0.5">
              <Avatar name={c.name} seed={c.username} size="h-6 w-6 text-xs" />
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <Keypad onKey={(k) => edit(to + k)} onBackspace={() => edit(to.slice(0, -1))} onClear={() => edit("")} />

      <div className="rounded-2xl border-2 border-dashed border-edge/50 px-2 pt-3 pb-2">
        <div className="flex items-start justify-center gap-1">
          <LanguageKnob label="I speak" value={sel.spoken_language} onChange={(c) => setSel({ ...sel, spoken_language: c })} />
          {line === "app" && (
            <>
              <button
                type="button"
                onClick={() => setSel({ ...sel, spoken_language: sel.listen_language, listen_language: sel.spoken_language })}
                className="btn-ghost mt-8 !min-h-9 h-9 w-9 shrink-0 !p-0"
                aria-label="Swap what I speak and hear"
                title="Swap"
              >
                <SwapIcon width={18} height={18} />
              </button>
              <LanguageKnob label="I hear" value={sel.listen_language} onChange={(c) => setSel({ ...sel, listen_language: c })} />
            </>
          )}
        </div>
        {line === "phone" && (
          <div className="px-2 pt-1 pb-1">
            <p className="label">They speak</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What the person you call speaks">
              {CALLER_LANGUAGES.map((l) => (
                <button
                  key={l || "auto"}
                  type="button"
                  role="radio"
                  aria-checked={callerLanguage === l}
                  onClick={() => setCallerLanguage(l)}
                  className={`rounded-full border-2 border-edge px-3 py-1 text-sm font-bold ${callerLanguage === l ? "bg-saffron text-[#1c1712]" : "bg-surface"} ${l ? scriptFont(l) : ""}`}
                >
                  {l ? NATIVE_NAMES[l] : "Detect"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">You hear them in your language. They hear a short notice that the call is translated by AI.</p>
          </div>
        )}
        {picked && changed && (
          <button type="button" onClick={() => void rememberFor(picked)} className="wm-pop mx-auto mt-1 block text-sm font-bold text-brand underline decoration-2 underline-offset-4">
            Remember these for {picked.name}
          </button>
        )}
      </div>

      <div className="flex items-end justify-around">
        {line === "app" ? (
          <RoundButton label="Video" onClick={() => callTyped(true)} disabled={busy || !to.trim()}>
            <CameraIcon width={24} height={24} />
          </RoundButton>
        ) : (
          <span className="w-14" />
        )}
        <RoundButton label={busy ? "Calling…" : "Call"} onClick={() => callTyped(false)} disabled={busy || (line === "app" ? !to.trim() : !phoneReady || phoneDigits < 10)} primary>
          <PhoneIcon width={30} height={30} />
        </RoundButton>
        {line === "app" ? (
          <RoundButton label="Save" onClick={() => openNew({ target: to.trim(), spoken_language: sel.spoken_language, listen_language: sel.listen_language })} disabled={!canSave}>
            <UserPlusIcon width={24} height={24} />
          </RoundButton>
        ) : (
          <span className="w-14" />
        )}
      </div>
      {line === "phone" && phoneConfig && phoneConfig.allowed_prefixes.length > 0 && (
        <p className="text-center text-xs text-muted">Indian numbers only ({phoneConfig.allowed_prefixes.join(", ")}).</p>
      )}
    </div>
  );

  /* ---------------- contacts ---------------- */
  const shown = query.trim() ? matchContacts(contacts, query, 500) : contacts;
  const groups = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of shown) {
      const letter = /^[A-Za-z]/.test(initialOf(c.name)) ? initialOf(c.name) : "#";
      map.set(letter, [...(map.get(letter) ?? []), c]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)));
  }, [shown, query]);
  const favorites = contacts.filter((c) => c.favorite);

  const contactsTab = (
    <div className="space-y-6">
      {form ? (
        <ContactForm
          key={form.contact?.id ?? "new"}
          contact={form.contact}
          draft={form.draft}
          onCancel={() => setForm(null)}
          onSaved={(c) => {
            setForm(null);
            void loadContacts();
            if (picked?.id === c.id) setPicked(c);
          }}
          onDeleted={(c) => {
            setForm(null);
            if (picked?.id === c.id) setPicked(null);
            void loadContacts();
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[12rem] flex-1">
            <SearchIcon width={18} height={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
            <input className="field !pl-10" placeholder="Search contacts" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search contacts" />
          </div>
          <button className="btn-primary" onClick={() => setForm({})}>
            <UserPlusIcon width={18} height={18} /> New contact
          </button>
        </div>
      )}

      {!query.trim() && favorites.length > 0 && !form && (
        <section aria-label="Favourites">
          <p className="eyebrow mb-2">Favourites</p>
          <ul className="flex gap-4 overflow-x-auto pb-2">
            {favorites.map((c) => (
              <li key={c.id} className="shrink-0">
                <button onClick={() => pick(c)} className="group flex w-[4.5rem] flex-col items-center gap-1.5" aria-label={`Call ${c.name}`}>
                  <Avatar name={c.name} seed={c.username} size="h-14 w-14 text-2xl shadow-[3px_3px_0_var(--color-shadow)] transition group-hover:-translate-y-0.5" />
                  <span className="w-full truncate text-center text-xs font-bold">{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {contacts.length === 0 && !form && (
        <div className="py-10 text-center">
          <p className="page-title text-[1.7rem]">Your phonebook is empty.</p>
          <p className="wm-hand mt-2 text-[1.2rem] text-muted">Save people you talk to often, with the languages you use together.</p>
        </div>
      )}

      {groups.map(([letter, list]) => (
        <section key={letter} id={`letter-${letter}`} aria-label={`Contacts ${letter}`} className="scroll-mt-20">
          <h3 className="mb-2 flex items-center gap-3 text-sm font-extrabold">
            <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-edge bg-butter text-[#1c1712]" style={{ fontFamily: "var(--font-display)" }}>
              {letter}
            </span>
            <span className="h-px flex-1 bg-line" />
          </h3>
          <ul className="space-y-3">
            {list.map((c) => (
              <li key={c.id} className="card flex flex-wrap items-center gap-x-4 gap-y-2 !rounded-2xl p-3 !shadow-[3px_3px_0_var(--color-shadow)]">
                <button onClick={() => pick(c)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Open ${c.name} in the keypad`}>
                  <Avatar name={c.name} seed={c.username} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-bold">
                      {c.name}
                      {c.favorite && <StarIcon width={14} height={14} className="shrink-0 fill-saffron text-saffron" aria-label="Favourite" />}
                    </span>
                    <span className="block truncate text-xs text-muted">@{c.username}</span>
                  </span>
                </button>
                <Route spoken={c.spoken_language} listen={c.listen_language} />
                <span className="flex gap-2">
                  <button className="btn-ghost !min-h-10 h-10 w-10 !p-0" onClick={() => setForm({ contact: c })} aria-label={`Edit ${c.name}`} title="Edit">
                    <PencilIcon width={18} height={18} />
                  </button>
                  <button className="btn-secondary !min-h-10 h-10 w-10 !p-0" onClick={() => callContact(c, true)} disabled={busy} aria-label={`Video call ${c.name}`} title="Video call">
                    <CameraIcon width={18} height={18} />
                  </button>
                  <button className="btn-primary !min-h-10 h-10 w-10 !p-0" onClick={() => callContact(c, false)} disabled={busy} aria-label={`Call ${c.name}`} title="Call">
                    <PhoneIcon width={18} height={18} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {contacts.length >= 12 && groups.length > 1 && (
        <nav className="fixed top-1/2 right-1 z-20 hidden -translate-y-1/2 flex-col text-[0.65rem] font-extrabold sm:flex" aria-label="Jump to letter">
          {groups.map(([letter]) => (
            <a key={letter} href={`#letter-${letter}`} className="px-1.5 py-px text-muted hover:text-ink">
              {letter}
            </a>
          ))}
        </nav>
      )}
    </div>
  );

  /* ---------------- recent ---------------- */
  const recentTab =
    history.length === 0 && phoneHistory.length === 0 ? (
      <div className="py-10 text-center">
        <p className="page-title text-[1.7rem]">No calls yet.</p>
        <p className="wm-hand mt-2 text-[1.2rem] text-muted">Calls you make and receive will be listed here.</p>
      </div>
    ) : (
      <div className="space-y-6">
      <ul className="space-y-3">
        {history.map((c) => {
          const missed = c.status === "missed" && c.direction === "incoming";
          const saved = contacts.find((x) => x.username.toLowerCase() === c.other_username.toLowerCase());
          return (
            <li key={c.id} className="card flex items-center gap-3 !rounded-2xl p-3 !shadow-[3px_3px_0_var(--color-shadow)]">
              <Avatar name={c.other_name} seed={c.other_username} />
              <div className="min-w-0 flex-1">
                <p className={`truncate font-bold ${missed ? "text-danger" : ""}`}>
                  <span aria-hidden="true">{c.direction === "incoming" ? "↙" : "↗"}</span> {saved?.name ?? c.other_name}
                </p>
                <p className="truncate text-xs text-muted">
                  {new Date(c.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {STATUS[c.status]}
                  {c.video ? " · video" : ""}
                </p>
              </div>
              {!saved && (
                <button className="btn-ghost !min-h-10 h-10 w-10 !p-0" aria-label={`Save ${c.other_name} to contacts`} title="Save to contacts" onClick={() => openNew({ target: c.other_username, spoken_language: sel.spoken_language, listen_language: sel.listen_language })}>
                  <UserPlusIcon width={18} height={18} />
                </button>
              )}
              <button
                className="btn-primary !min-h-10 h-10 w-10 !p-0"
                disabled={busy}
                aria-label={`Call ${c.other_name} back`}
                title="Call back"
                onClick={() => (saved ? callContact(saved, c.video) : void place(c.other_username, sel, c.video))}
              >
                <PhoneIcon width={18} height={18} />
              </button>
            </li>
          );
        })}
      </ul>
      {phoneHistory.length > 0 && (
        <section aria-label="Phone calls">
          <p className="eyebrow mb-2">Phone calls</p>
          <ul className="space-y-3">
            {phoneHistory.slice(0, 15).map((c) => (
              <li key={c.id} className="card flex items-center gap-3 !rounded-2xl p-3 !shadow-[3px_3px_0_var(--color-shadow)]">
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-bold ${c.status === "missed" ? "text-danger" : ""}`}>
                    <span aria-hidden="true">{c.direction === "inbound" ? "↙" : "↗"}</span> {c.remote_number || "Unknown number"}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {new Date(c.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {PHONE_STATUS[c.status]}
                  </p>
                </div>
                <button
                  className="btn-primary !min-h-10 h-10 w-10 !p-0"
                  aria-label={`Dial ${c.remote_number} again`}
                  title="Dial again"
                  onClick={() => {
                    setLine("phone");
                    setPicked(null);
                    setTo(c.remote_number);
                    goTab("keypad");
                  }}
                >
                  <PhoneIcon width={18} height={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    );

  return (
    <Layout>
      <PageHeader eyebrow="Calls" title="Dial" description="Call anyone on Asta Talk by name, username or mobile number, free, and you each hear the other in your own language. Or switch to Normal phone to ring any Indian mobile or landline when a phone line is connected." />
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onDismiss={() => setError("")} />
        </div>
      )}
      <div className="mb-6 grid grid-cols-3 gap-2.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => goTab(t.key)}
            className={`flex min-h-[3.4rem] flex-col items-center justify-center gap-0.5 rounded-2xl border-[2.5px] border-edge px-2 text-[0.85rem] font-bold transition duration-200 sm:flex-row sm:gap-2 sm:text-[0.95rem] ${
              tab === t.key ? "-rotate-1 bg-saffron text-[#1c1712] shadow-[4px_4px_0_var(--color-shadow)]" : "bg-surface hover:-translate-y-0.5"
            }`}
          >
            <t.icon width={20} height={20} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === "keypad" && keypad}
      {tab === "contacts" && contactsTab}
      {tab === "recent" && recentTab}
    </Layout>
  );
}
