import { Pressable, Switch, Text, View } from "react-native";

import { MEETING_LANGUAGES } from "../lib/meetings";
import { Field, colors, styles } from "./ui";

export interface MeetingSetupValue {
  title: string;
  spoken_language: string; // "auto" allowed for recordings/uploads
  translation_language: string; // "" = none
  consent: boolean;
}

export function defaultMeetingSetup(spoken = "ta"): MeetingSetupValue {
  const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return { title: `Meeting ${date}`, spoken_language: spoken, translation_language: "en", consent: false };
}

export const CONSENT_TEXT =
  "Everyone recorded agreed to the recording, its storage on our server, and its processing by AI (Sarvam AI for speech and translation; Claude for notes if used). It is kept until I delete it.";

function Chips({ options, value, onChange }: { options: { code: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const active = o.code === value;
        return (
          <Pressable
            key={o.code || "none"}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.code)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 999,
              borderWidth: active ? 2 : 1,
              borderColor: active ? colors.brand : colors.line,
              backgroundColor: active ? colors.brandSoft : "#fff",
            }}
          >
            <Text style={{ fontWeight: "600", color: active ? colors.brand : colors.ink }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MeetingSetup({ value, onChange, allowAuto = true }: { value: MeetingSetupValue; onChange: (v: MeetingSetupValue) => void; allowAuto?: boolean }) {
  const langs = MEETING_LANGUAGES.map((l) => ({ code: l.code, label: l.native }));
  return (
    <View>
      <Field label="Meeting title" value={value.title} onChangeText={(title) => onChange({ ...value, title })} maxLength={200} />
      <Text style={styles.label}>Spoken language</Text>
      <Chips options={allowAuto ? [{ code: "auto", label: "Auto / mixed" }, ...langs] : langs} value={value.spoken_language} onChange={(spoken_language) => onChange({ ...value, spoken_language })} />
      <Text style={[styles.label, { marginTop: 14 }]}>Translate into</Text>
      <Chips options={[{ code: "", label: "None" }, ...langs]} value={value.translation_language} onChange={(translation_language) => onChange({ ...value, translation_language })} />
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", marginTop: 16, backgroundColor: "#f8fafc", borderRadius: 12, padding: 12 }}>
        <Switch value={value.consent} onValueChange={(consent) => onChange({ ...value, consent })} trackColor={{ true: colors.brand }} accessibilityLabel="Consent" />
        <Text style={{ flex: 1, fontSize: 13, color: colors.ink, lineHeight: 18 }}>{CONSENT_TEXT}</Text>
      </View>
    </View>
  );
}
