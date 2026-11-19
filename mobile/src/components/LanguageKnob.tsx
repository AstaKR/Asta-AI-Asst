import { useEffect, useState } from "react";
import { Animated, Easing, Pressable, Text, Vibration, View } from "react-native";

import { LANGUAGE_NAMES, NATIVE_NAMES } from "../lib/languages";
import { colors, fonts } from "./ui";

const CODES = Object.keys(LANGUAGE_NAMES);
const ARC = 52; // degrees between positions on the dial
const W = 150;
const H = 120;
// Where each language label sits above the knob (% of width and height): left, top, right.
const SPOTS = [
  { x: 22, y: 38 },
  { x: 50, y: 10 },
  { x: 78, y: 38 },
];

/**
 * A rotary language selector: the pointer swings to the language you pick, like a radio dial.
 * Tap a language, or tap the knob to step to the next one.
 */
export function LanguageKnob({ label, value, onChange }: { label: string; value: string; onChange: (code: string) => void }) {
  const index = Math.max(0, CODES.indexOf(value));
  const target = (index - (CODES.length - 1) / 2) * ARC;
  const [angle] = useState(() => new Animated.Value(target));

  useEffect(() => {
    Animated.timing(angle, { toValue: target, duration: 380, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }).start();
  }, [angle, target]);

  const pick = (code: string) => {
    if (code !== value) Vibration.vibrate(8);
    onChange(code);
  };
  const rotate = angle.interpolate({ inputRange: [-360, 360], outputRange: ["-360deg", "360deg"] });

  return (
    <View style={{ alignItems: "center" }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={{ fontSize: 11, fontFamily: fonts.sansBold, letterSpacing: 1.6, color: colors.chilliText, textTransform: "uppercase", marginBottom: 2 }}>{label}</Text>
      <View style={{ width: W, height: H }}>
        {CODES.map((code, i) => {
          const spot = SPOTS[i] ?? SPOTS[1];
          const on = code === value;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={LANGUAGE_NAMES[code]}
              onPress={() => pick(code)}
              hitSlop={6}
              style={{
                position: "absolute",
                left: (spot.x / 100) * W - 34,
                top: (spot.y / 100) * H - 15,
                width: 68,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  borderWidth: 2,
                  borderColor: colors.ink,
                  borderRadius: 999,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  backgroundColor: on ? colors.saffron : colors.surface,
                  transform: [{ scale: on ? 1.08 : 1 }],
                }}
              >
                <Text numberOfLines={1} style={{ fontSize: 13, color: colors.ink, fontFamily: fonts.sansBold }}>
                  {NATIVE_NAMES[code]}
                </Text>
              </View>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => pick(CODES[(index + 1) % CODES.length])}
          accessibilityLabel={`${label}: ${LANGUAGE_NAMES[value] ?? value}. Tap for the next language`}
          style={{
            position: "absolute",
            bottom: 2,
            left: W / 2 - 26,
            width: 52,
            height: 52,
            borderRadius: 26,
            borderWidth: 2.5,
            borderColor: colors.ink,
            backgroundColor: colors.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, transform: [{ rotate }] }}>
            <View style={{ position: "absolute", top: 3, left: 26 - 1.5, width: 3, height: 17, borderRadius: 2, backgroundColor: colors.chilliText }} />
          </Animated.View>
          <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.saffron }} />
        </Pressable>
      </View>
    </View>
  );
}
