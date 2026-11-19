import { useRef } from "react";
import { Pressable, Text, Vibration, View } from "react-native";

import { KEY_LETTERS } from "../lib/smartDial";
import { Icon, Sticker, colors, fonts } from "./ui";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0"] as const;

/** A phone keypad. Keys give a tiny buzz; hold the delete key to clear everything. */
export function Keypad({ onKey, onBackspace, onClear }: { onKey: (k: string) => void; onBackspace: () => void; onClear: () => void }) {
  const cleared = useRef(false);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 4 }} accessibilityLabel="Keypad">
      {KEYS.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityLabel={KEY_LETTERS[k] ? `${k} ${KEY_LETTERS[k].split("").join(" ")}` : k}
          onPress={() => {
            Vibration.vibrate(8);
            onKey(k);
          }}
          style={{ width: "31.5%" }}
        >
          {({ pressed }) => (
            <Sticker bg={pressed ? colors.saffron : colors.surface} radius={18} offset={3} pressed={pressed} style={{ height: 58, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 26, fontFamily: fonts.display, color: colors.ink, lineHeight: 28 }}>{k}</Text>
              <Text style={{ fontSize: 9, letterSpacing: 2, fontFamily: fonts.sansBold, color: colors.muted, height: 11 }}>{KEY_LETTERS[k]}</Text>
            </Sticker>
          )}
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete the last character (hold to clear)"
        onPress={() => {
          if (cleared.current) {
            cleared.current = false;
            return;
          }
          Vibration.vibrate(8);
          onBackspace();
        }}
        onLongPress={() => {
          cleared.current = true;
          Vibration.vibrate(20);
          onClear();
        }}
        delayLongPress={600}
        style={{ width: "31.5%" }}
      >
        {({ pressed }) => (
          <Sticker bg={colors.subtle} radius={18} offset={3} pressed={pressed} style={{ height: 58, alignItems: "center", justifyContent: "center" }}>
            <Icon name="backspace-outline" size={26} />
          </Sticker>
        )}
      </Pressable>
    </View>
  );
}
