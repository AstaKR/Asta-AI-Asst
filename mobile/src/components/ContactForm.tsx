import { useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";

import { ApiError, contactsApi } from "../api";
import type { Contact } from "../types";
import { LanguageKnob } from "./LanguageKnob";
import { Banner, Button, Card, Field, colors, fonts, styles } from "./ui";

const VOICES = ["shubh", "aditya", "rahul", "rohan", "amit", "ritu", "priya", "neha", "pooja", "kavya"];

export interface ContactDraft {
  target: string;
  spoken_language: string;
  listen_language: string;
}

/** Add a person to the phonebook, or change one: who they are and how you talk to them. */
export function ContactForm({
  contact,
  draft,
  onSaved,
  onCancel,
  onDeleted,
}: {
  contact?: Contact;
  draft?: ContactDraft;
  onSaved: (c: Contact) => void;
  onCancel: () => void;
  onDeleted?: (c: Contact) => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [target, setTarget] = useState(contact?.target ?? draft?.target ?? "");
  const [spoken, setSpoken] = useState(contact?.spoken_language ?? draft?.spoken_language ?? "ta-IN");
  const [listen, setListen] = useState(contact?.listen_language ?? draft?.listen_language ?? "ta-IN");
  const [voice, setVoice] = useState(contact?.voice ?? "");
  const [favorite, setFavorite] = useState(contact?.favorite ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const saved = contact
        ? await contactsApi.update(contact.id, { name: name.trim(), spoken_language: spoken, listen_language: listen, voice, favorite })
        : await contactsApi.create({ target: target.trim(), name: name.trim(), spoken_language: spoken, listen_language: listen, voice, favorite });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the contact");
      setBusy(false);
    }
  }

  function remove() {
    if (!contact) return;
    Alert.alert(`Remove ${contact.name}?`, "They will be taken out of your contacts.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await contactsApi.remove(contact.id);
            onDeleted?.(contact);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not remove the contact");
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <Card>
      <Text style={[styles.title, { fontSize: 22 }]}>{contact ? "Edit contact" : "New contact"}</Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label="Name" value={name} onChangeText={setName} maxLength={60} placeholder="Ravi anna" />
      <Field
        label="Username or mobile number"
        value={target}
        onChangeText={setTarget}
        maxLength={40}
        placeholder="ravi or 98765 43210"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!contact}
        style={contact ? { opacity: 0.6 } : undefined}
      />

      <Text style={styles.label}>How you talk to them</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-around", borderWidth: 2, borderStyle: "dashed", borderColor: colors.line, borderRadius: 16, paddingVertical: 10, marginBottom: 14 }}>
        <LanguageKnob label="I speak" value={spoken} onChange={setSpoken} />
        <LanguageKnob label="I hear" value={listen} onChange={setListen} />
      </View>

      <Text style={styles.label}>Your translated voice for this person</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {["", ...VOICES].map((v) => {
          const on = voice === v;
          return (
            <Pressable
              key={v || "default"}
              onPress={() => setVoice(v)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: on ? colors.saffron : colors.surface }}
            >
              <Text style={{ fontFamily: fonts.sansBold, color: colors.ink }}>{v ? v[0].toUpperCase() + v.slice(1) : "Default"}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.label}>Favourite</Text>
          <Text style={styles.muted}>Favourites sit at the top of your contacts.</Text>
        </View>
        <Switch value={favorite} onValueChange={setFavorite} trackColor={{ false: colors.line, true: colors.saffron }} thumbColor={colors.ink} accessibilityLabel="Favourite" />
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button label={busy ? "Saving…" : contact ? "Save changes" : "Save contact"} onPress={() => void submit()} disabled={busy || !target.trim()} style={{ flex: 1.4 }} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
      </View>
      {contact ? (
        <Pressable onPress={remove} disabled={busy} style={{ alignSelf: "center", marginTop: 14 }} accessibilityRole="button">
          <Text style={{ color: colors.danger, fontFamily: fonts.sansBold }}>Remove from contacts</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}
