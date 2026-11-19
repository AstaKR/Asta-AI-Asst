import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ApiError, api, contactsApi, directApi, phoneApi, type LanguageSelection } from "../api";
import { useAuth } from "../auth";
import { ContactForm, type ContactDraft } from "../components/ContactForm";
import { IncomingCalls } from "../components/IncomingCalls";
import { Keypad } from "../components/Keypad";
import { LanguageKnob } from "../components/LanguageKnob";
import { Avatar, Banner, Card, Field, Icon, Muted, Screen, Sticker, colors, fonts, styles, type IconName } from "../components/ui";
import { NATIVE_NAMES } from "../lib/languages";
import { initialOf, matchContacts } from "../lib/smartDial";
import type { Contact, DirectCall, PhoneCall, PhoneConfig } from "../types";

type Tab = "keypad" | "contacts" | "recent";
type Line = "app" | "phone";
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "keypad", label: "Keypad", icon: "keypad" },
  { key: "contacts", label: "Contacts", icon: "people" },
  { key: "recent", label: "Recent", icon: "time" },
];
const CALLER_LANGUAGES = ["", "ta-IN", "hi-IN", "en-IN"]; // "" = detect from their speech

const DIRECT_STATUS: Record<DirectCall["status"], string> = {
  ringing: "Ringing",
  answered: "Answered",
  declined: "Declined",
  missed: "Missed",
  cancelled: "Cancelled",
  ended: "Ended",
};
const PHONE_STATUS: Record<PhoneCall["status"], string> = {
  ringing: "Ringing",
  answered: "In call",
  missed: "Missed",
  declined: "Declined",
  failed: "Failed",
  ended: "Ended",
};

/** "தமிழ் → हिन्दी": what you speak, then what you hear. */
function Route({ spoken, listen }: { spoken: string; listen: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: colors.ink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, backgroundColor: colors.surface }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.sansBold, color: colors.ink }}>{NATIVE_NAMES[spoken] ?? spoken}</Text>
      {spoken !== listen ? (
        <>
          <Text style={{ color: colors.chilliText, fontSize: 12 }}>→</Text>
          <Text style={{ fontSize: 12, fontFamily: fonts.sansBold, color: colors.ink }}>{NATIVE_NAMES[listen] ?? listen}</Text>
        </>
      ) : null}
    </View>
  );
}

/** A round action button: Call (saffron, big), Video and Save. */
function RoundButton({ label, icon, onPress, disabled, primary }: { label: string; icon: IconName; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const size = primary ? 74 : 56;
  return (
    <View style={{ alignItems: "center", gap: 4, opacity: disabled ? 0.45 : 1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled}>
        {({ pressed }) => (
          <Sticker bg={primary ? colors.saffron : colors.surface} radius={size / 2} offset={3} pressed={pressed} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
            <Icon name={icon} size={primary ? 32 : 24} />
          </Sticker>
        )}
      </Pressable>
      <Text style={{ fontSize: 12, fontFamily: fonts.sansBold, color: colors.ink }}>{label}</Text>
    </View>
  );
}

function SmallRound({ icon, label, onPress, primary, disabled }: { icon: IconName; label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={{ opacity: disabled ? 0.45 : 1 }}>
      {({ pressed }) => (
        <Sticker bg={primary ? colors.saffron : colors.surface} radius={20} offset={2} pressed={pressed} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={18} />
        </Sticker>
      )}
    </Pressable>
  );
}

/** Dial: call a person on Asta Talk (free) from a keypad with smart contact matching, a phonebook and recent calls; or a normal phone number when a phone line is connected. */
export default function DialScreen() {
  const { user } = useAuth();
  const prefs = user?.preferences;

  const [tab, setTab] = useState<Tab>("keypad");
  const [line, setLine] = useState<Line>("app");
  const [to, setTo] = useState("");
  const [sel, setSel] = useState<LanguageSelection>({
    spoken_language: prefs?.spoken_language ?? "ta-IN",
    listen_language: prefs?.listen_language ?? "ta-IN",
    voice: prefs?.voice ?? "",
  });
  const [callerLanguage, setCallerLanguage] = useState("");
  const [picked, setPicked] = useState<Contact | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [history, setHistory] = useState<DirectCall[]>([]);
  const [phoneConfig, setPhoneConfig] = useState<PhoneConfig | null>(null);
  const [phoneHistory, setPhoneHistory] = useState<PhoneCall[]>([]);
  const [form, setForm] = useState<null | { contact?: Contact; draft?: ContactDraft }>(null);
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadContacts = useCallback(() => contactsApi.list().then(setContacts).catch(() => undefined), []);
  useFocusEffect(
    useCallback(() => {
      void loadContacts();
      directApi.list().then(setHistory).catch(() => undefined);
      phoneApi.config().then(setPhoneConfig).catch(() => undefined);
      phoneApi.calls().then(setPhoneHistory).catch(() => undefined);
    }, [loadContacts]),
  );

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
    setTab("keypad");
  }

  async function place(target: string, langs: LanguageSelection, video: boolean, remember = false) {
    if (!target.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await directApi.call({ to: target.trim(), ...langs, video });
      if (remember) void api.savePreferences({ spoken_language: langs.spoken_language, listen_language: langs.listen_language });
      router.push(`/call/${res.room_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the call");
    } finally {
      setBusy(false);
    }
  }

  async function placePhone() {
    setBusy(true);
    setError("");
    try {
      const res = await phoneApi.dial({ number: to, spoken_language: sel.spoken_language, listen_language: sel.listen_language, caller_language: callerLanguage });
      void api.savePreferences({ spoken_language: sel.spoken_language, listen_language: sel.listen_language });
      router.push(`/call/${res.room_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the call");
    } finally {
      setBusy(false);
    }
  }

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
  const canSave = line === "app" && to.trim() && !picked && !known.has(to.trim().toLowerCase().replace(/^@/, ""));
  const phoneReady = phoneConfig?.dial_enabled ?? false;
  const phoneDigits = to.replace(/\D/g, "").length;

  function openNew(draft?: ContactDraft) {
    setForm({ draft });
    setTab("contacts");
  }

  /* ---------------- keypad ---------------- */
  const keypad = (
    <>
      <View style={{ flexDirection: "row", backgroundColor: colors.subtle, borderRadius: 999, padding: 4, marginBottom: 14 }} accessibilityRole="tablist">
        {(["app", "phone"] as Line[]).map((l) => (
          <Pressable
            key={l}
            onPress={() => {
              setLine(l);
              setPicked(null);
              setError("");
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: line === l }}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: "center", backgroundColor: line === l ? colors.surface : "transparent", borderWidth: line === l ? 2 : 0, borderColor: colors.ink }}
          >
            <Text style={{ fontFamily: fonts.sansBold, color: line === l ? colors.ink : colors.muted }}>{l === "app" ? "On Asta Talk (free)" : "Normal phone"}</Text>
          </Pressable>
        ))}
      </View>

      {line === "phone" && phoneConfig && !phoneReady ? (
        <Banner tone="warn">Calling normal phone numbers is not set up yet: it needs a paid phone line on the server. Use “On Asta Talk” to call people who have the app, free.</Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Card>
        <View style={{ backgroundColor: "#ffd66b", borderWidth: 2.5, borderColor: colors.ink, borderRadius: 20, padding: 12, marginBottom: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 11, fontFamily: fonts.sansBold, letterSpacing: 1.6, color: colors.ink, textTransform: "uppercase" }}>{picked ? "Calling" : line === "phone" ? "Phone number" : "Dialling"}</Text>
            {line === "app" ? (
              <Pressable onPress={() => setTyping(!typing)} accessibilityRole="button" accessibilityState={{ selected: typing }} style={{ borderWidth: 2, borderColor: colors.ink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
                <Text style={{ fontSize: 11, fontFamily: fonts.sansBold, color: colors.ink }}>{typing ? "Keypad only" : "Type a name"}</Text>
              </Pressable>
            ) : null}
          </View>
          {picked ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
              <Avatar name={picked.name} size={34} />
              <Text style={{ flex: 1, fontFamily: fonts.sansBold, fontSize: 16, color: colors.ink }} numberOfLines={1}>
                {picked.name}
              </Text>
              <Route spoken={picked.spoken_language} listen={picked.listen_language} />
            </View>
          ) : null}
          <TextInput
            value={to}
            onChangeText={edit}
            onSubmitEditing={() => (line === "app" ? void place(to, sel, false, !picked) : phoneReady && phoneDigits >= 10 && void placePhone())}
            showSoftInputOnFocus={typing}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={line === "app" ? "Username or mobile number" : "Phone number"}
            placeholder={line === "app" ? "name or number" : "+91 98765 43210"}
            placeholderTextColor="rgba(28,23,18,0.5)"
            keyboardType={typing ? "default" : "phone-pad"}
            style={{ textAlign: "center", fontSize: 30, letterSpacing: 1.5, color: colors.ink, fontFamily: fonts.display, paddingVertical: 4 }}
          />
          <View style={{ minHeight: 34, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 }} accessibilityLiveRegion="polite">
            {suggestions.map((c) => (
              <Pressable key={c.id} onPress={() => pick(c)} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 2, borderColor: colors.ink, borderRadius: 999, backgroundColor: colors.surface, paddingRight: 10 }}>
                <Avatar name={c.name} size={24} />
                <Text style={{ fontFamily: fonts.sansBold, color: colors.ink, fontSize: 13 }}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Keypad onKey={(k) => edit(to + k)} onBackspace={() => edit(to.slice(0, -1))} onClear={() => edit("")} />

        <View style={{ marginTop: 18, borderWidth: 2, borderStyle: "dashed", borderColor: colors.line, borderRadius: 16, paddingTop: 8, paddingBottom: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "center" }}>
            <LanguageKnob label="I speak" value={sel.spoken_language} onChange={(c) => setSel({ ...sel, spoken_language: c })} />
            {line === "app" ? (
              <>
                <Pressable
                  onPress={() => setSel({ ...sel, spoken_language: sel.listen_language, listen_language: sel.spoken_language })}
                  accessibilityRole="button"
                  accessibilityLabel="Swap what I speak and hear"
                  style={{ marginTop: 40, padding: 6 }}
                >
                  <Icon name="swap-horizontal" size={22} />
                </Pressable>
                <LanguageKnob label="I hear" value={sel.listen_language} onChange={(c) => setSel({ ...sel, listen_language: c })} />
              </>
            ) : null}
          </View>
          {line === "phone" ? (
            <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
              <Text style={[styles.label, { marginTop: 4 }]}>They speak</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {CALLER_LANGUAGES.map((l) => {
                  const on = callerLanguage === l;
                  return (
                    <Pressable key={l || "auto"} onPress={() => setCallerLanguage(l)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: on ? colors.saffron : colors.surface }}>
                      <Text style={{ fontFamily: fonts.sansBold, color: colors.ink }}>{l ? NATIVE_NAMES[l] : "Detect"}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Muted style={{ marginTop: 6, fontSize: 12 }}>They hear a short notice that the call is translated by AI.</Muted>
            </View>
          ) : null}
          {picked && changed ? (
            <Pressable onPress={() => void rememberFor(picked)} accessibilityRole="button" style={{ alignSelf: "center", marginTop: 2, marginBottom: 4 }}>
              <Text style={{ color: colors.brand, fontFamily: fonts.sansBold, textDecorationLine: "underline" }}>Remember these for {picked.name}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", marginTop: 20, marginBottom: 6 }}>
          {line === "app" ? (
            <RoundButton label="Video" icon="videocam" onPress={() => void place(to, sel, true, !picked)} disabled={busy || !to.trim()} />
          ) : (
            <View style={{ width: 56 }} />
          )}
          <RoundButton
            label={busy ? "Calling…" : "Call"}
            icon="call"
            primary
            onPress={() => (line === "app" ? void place(to, sel, false, !picked) : void placePhone())}
            disabled={busy || (line === "app" ? !to.trim() : !phoneReady || phoneDigits < 10)}
          />
          {line === "app" ? (
            <RoundButton label="Save" icon="person-add" onPress={() => openNew({ target: to.trim(), spoken_language: sel.spoken_language, listen_language: sel.listen_language })} disabled={!canSave} />
          ) : (
            <View style={{ width: 56 }} />
          )}
        </View>
        {line === "phone" && phoneConfig?.allowed_prefixes.length ? <Muted style={{ fontSize: 12, textAlign: "center" }}>Indian numbers only ({phoneConfig.allowed_prefixes.join(", ")}).</Muted> : null}
      </Card>
    </>
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
  }, [shown]);
  const favorites = contacts.filter((c) => c.favorite);

  const contactsTab = (
    <>
      {error ? <Banner tone="danger">{error}</Banner> : null}
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
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label="Search contacts" value={query} onChangeText={setQuery} placeholder="Name, username or number" autoCapitalize="none" />
          </View>
          <View style={{ marginTop: 24 }}>
            <SmallRound icon="person-add" label="New contact" onPress={() => setForm({})} primary />
          </View>
        </View>
      )}

      {!query.trim() && favorites.length > 0 && !form ? (
        <View style={{ marginBottom: 14 }}>
          <Text style={styles.eyebrow}>Favourites</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 6 }}>
            {favorites.map((c) => (
              <Pressable key={c.id} onPress={() => pick(c)} accessibilityRole="button" accessibilityLabel={`Call ${c.name}`} style={{ width: 66, alignItems: "center", gap: 4 }}>
                <Avatar name={c.name} size={54} />
                <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.sansBold, color: colors.ink, maxWidth: 66 }}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {contacts.length === 0 && !form ? (
        <View style={{ paddingVertical: 36, alignItems: "center" }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 24, color: colors.ink, textAlign: "center" }}>Your phonebook is empty.</Text>
          <Muted style={{ marginTop: 8, textAlign: "center" }}>Save people you talk to often, with the languages you use together.</Muted>
        </View>
      ) : null}

      {groups.map(([letter, list]) => (
        <View key={letter} style={{ marginBottom: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#ffd66b", borderWidth: 2, borderColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: fonts.display, fontSize: 13, color: colors.ink }}>{letter}</Text>
            </View>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
          </View>
          {list.map((c) => (
            <Sticker key={c.id} radius={18} offset={3} outer={{ marginBottom: 12 }} style={{ padding: 10 }}>
              <Pressable onPress={() => pick(c)} accessibilityRole="button" accessibilityLabel={`Open ${c.name} in the keypad`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Avatar name={c.name} size={42} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.sansBold, fontSize: 16, color: colors.ink, flexShrink: 1 }}>
                      {c.name}
                    </Text>
                    {c.favorite ? <Icon name="star" size={14} color={colors.saffronDeep} /> : null}
                  </View>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.sans }}>
                    @{c.username}
                  </Text>
                </View>
              </Pressable>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                <Route spoken={c.spoken_language} listen={c.listen_language} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <SmallRound icon="pencil" label={`Edit ${c.name}`} onPress={() => setForm({ contact: c })} />
                  <SmallRound icon="videocam" label={`Video call ${c.name}`} onPress={() => callContact(c, true)} disabled={busy} />
                  <SmallRound icon="call" label={`Call ${c.name}`} onPress={() => callContact(c, false)} disabled={busy} primary />
                </View>
              </View>
            </Sticker>
          ))}
        </View>
      ))}
    </>
  );

  /* ---------------- recent ---------------- */
  const recentTab = (
    <>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {history.length === 0 && phoneHistory.length === 0 ? (
        <View style={{ paddingVertical: 36, alignItems: "center" }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 24, color: colors.ink }}>No calls yet.</Text>
          <Muted style={{ marginTop: 8, textAlign: "center" }}>Calls you make and receive will be listed here.</Muted>
        </View>
      ) : null}
      {history.map((c) => {
        const missed = c.status === "missed" && c.direction === "incoming";
        const saved = contacts.find((x) => x.username.toLowerCase() === c.other_username.toLowerCase());
        return (
          <Sticker key={c.id} radius={18} offset={3} outer={{ marginBottom: 12 }} style={{ padding: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar name={c.other_name} size={42} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.sansBold, fontSize: 16, color: missed ? colors.danger : colors.ink }}>
                {c.direction === "incoming" ? "↙" : "↗"} {saved?.name ?? c.other_name}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.sans }}>
                {new Date(c.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {DIRECT_STATUS[c.status]}
                {c.video ? " · video" : ""}
              </Text>
            </View>
            {!saved ? <SmallRound icon="person-add" label={`Save ${c.other_name} to contacts`} onPress={() => openNew({ target: c.other_username, spoken_language: sel.spoken_language, listen_language: sel.listen_language })} /> : null}
            <SmallRound
              icon="call"
              label={`Call ${c.other_name} back`}
              primary
              disabled={busy}
              onPress={() => (saved ? callContact(saved, c.video) : void place(c.other_username, sel, c.video))}
            />
          </Sticker>
        );
      })}
      {phoneHistory.length > 0 ? (
        <>
          <Text style={[styles.eyebrow, { marginTop: 10 }]}>Phone calls</Text>
          {phoneHistory.slice(0, 15).map((c) => (
            <Pressable
              key={c.id}
              onPress={() => {
                setLine("phone");
                setPicked(null);
                setTo(c.remote_number);
                setTab("keypad");
              }}
              accessibilityRole="button"
              accessibilityHint="Dial this number again"
            >
              <Sticker radius={18} offset={3} outer={{ marginBottom: 12 }} style={{ padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.sansBold, fontSize: 16, color: c.status === "missed" ? colors.danger : colors.ink }}>{c.remote_number || "Unknown number"}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.sans }}>{new Date(c.created_at).toLocaleString()}</Text>
                </View>
                <Muted>{PHONE_STATUS[c.status]}</Muted>
              </Sticker>
            </Pressable>
          ))}
        </>
      ) : null}
    </>
  );

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}>
        <IncomingCalls phoneEnabled={false} />
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }} accessibilityRole="tablist">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={{ flex: 1 }}>
                <Sticker bg={on ? colors.saffron : colors.surface} radius={16} offset={on ? 3 : 2} style={{ minHeight: 52, alignItems: "center", justifyContent: "center", gap: 2, transform: [{ rotate: on ? "-1deg" : "0deg" }] }}>
                  <Icon name={t.icon} size={19} />
                  <Text style={{ fontSize: 12, fontFamily: fonts.sansBold, color: colors.ink }}>{t.label}</Text>
                </Sticker>
              </Pressable>
            );
          })}
        </View>
        {tab === "keypad" ? keypad : tab === "contacts" ? contactsTab : recentTab}
      </ScrollView>
    </Screen>
  );
}
