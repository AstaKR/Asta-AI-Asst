import { Pressable, Text, View } from "react-native";

import type { LanguageSelection } from "../api";
import { LANGUAGE_NAMES, NATIVE_NAMES } from "../lib/languages";
import { colors, styles } from "./ui";

const CODES = Object.keys(LANGUAGE_NAMES);

/** One language for speaking and listening (the common case on calls). */
export function LanguagePicker({ value, onChange }: { value: LanguageSelection; onChange: (v: LanguageSelection) => void }) {
  return (
    <View>
      <Text style={styles.label}>Your language</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {CODES.map((code) => {
          const active = value.spoken_language === code;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => onChange({ ...value, spoken_language: code, listen_language: code })}
              style={{
                flex: 1,
                borderWidth: active ? 2 : 1,
                borderColor: active ? colors.brand : colors.line,
                backgroundColor: active ? colors.brandSoft : "#fff",
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.ink }}>{NATIVE_NAMES[code]}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{LANGUAGE_NAMES[code]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.muted, { marginTop: 8 }]}>You speak in this language and hear the other person translated into it.</Text>
    </View>
  );
}
