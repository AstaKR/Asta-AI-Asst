import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Text, View } from "react-native";

import { colors } from "./ui";

export const SEAT_COLORS = [colors.brand, colors.accent, "#27e3ff", "#ff5fb8", colors.warn, colors.danger];

/** Fades and slides its child in when it first appears (new transcript lines, notes). */
export function FadeIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>{children}</Animated.View>
  );
}

/**
 * Glowing orb that swells and ripples with the microphone level (dBFS, about -60 quiet to 0 loud). It idles with a
 * gentle breathing motion so it never looks frozen.
 */
export function LevelOrb({ levelDb, active }: { levelDb: number; active: boolean }) {
  const [level] = useState(() => new Animated.Value(0));
  const [breath] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const target = active ? Math.max(0, Math.min(1, (levelDb + 55) / 40)) : 0;
    Animated.timing(level, { toValue: target, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [levelDb, active, level]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);

  const ring = (i: number) => ({
    position: "absolute" as const,
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 1.5,
    borderColor: "#27e3ff",
    opacity: level.interpolate({ inputRange: [0, 1], outputRange: [0, 0.8 - i * 0.25] }),
    transform: [{ scale: level.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35 + i * 0.3] }) }],
  });
  const bars = [0.5, 0.8, 1, 0.7, 0.9, 0.6, 0.4];

  return (
    <View style={{ width: 190, height: 190, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden>
      <Animated.View
        style={{
          position: "absolute",
          width: 170,
          height: 170,
          borderRadius: 85,
          backgroundColor: colors.glow,
          opacity: level.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.42] }),
          transform: [{ scale: level.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.1] }) }],
        }}
      />
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} style={ring(i)} />
      ))}
      <Animated.View
        style={{
          width: 112,
          height: 112,
          borderRadius: 56,
          backgroundColor: colors.surfaceStrong,
          borderWidth: 1,
          borderColor: colors.glow,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 4,
          transform: [
            { scale: Animated.add(level.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }), breath.interpolate({ inputRange: [0, 1], outputRange: [0, 0.04] })) },
          ],
        }}
      >
        {bars.map((h, i) => (
          <Animated.View
            key={i}
            style={{
              width: 4,
              height: 44,
              borderRadius: 2,
              backgroundColor: i % 2 ? "#27e3ff" : colors.brand,
              transform: [{ scaleY: level.interpolate({ inputRange: [0, 1], outputRange: [0.18 + h * 0.1, 0.35 + h * 0.65] }) }],
            }}
          />
        ))}
      </Animated.View>
    </View>
  );
}

export interface Seat {
  name: string;
  color: string;
  words: number;
  active: boolean;
}

function Avatar({ seat }: { seat: Seat }) {
  const [pulse] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 6, useNativeDriver: true }).start();
  }, [pop]);
  useEffect(() => {
    if (!seat.active) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [seat.active, pulse]);
  const label = seat.name.replace(/^speaker\s*/i, "").trim().slice(0, 2).toUpperCase() || "?";
  return (
    <Animated.View style={{ alignItems: "center", width: 74, opacity: pop, transform: [{ scale: pop }] }} accessibilityLabel={`${seat.name}${seat.active ? ", spoke last" : ""}`}>
      <View style={{ width: 54, height: 54, alignItems: "center", justifyContent: "center" }}>
        {seat.active ? (
          <Animated.View
            style={{
              position: "absolute",
              width: 54,
              height: 54,
              borderRadius: 27,
              borderWidth: 2,
              borderColor: seat.color,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
            }}
          />
        ) : null}
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.surfaceStrong,
            borderWidth: seat.active ? 3 : 1.5,
            borderColor: seat.color,
          }}
        >
          <Text style={{ color: colors.ink, fontWeight: "800", fontSize: 15 }}>{label}</Text>
        </View>
      </View>
      <Text numberOfLines={1} style={{ color: seat.active ? colors.ink : colors.muted, fontSize: 11, fontWeight: "700", marginTop: 4 }}>
        {seat.name}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 10 }}>{seat.words} words</Text>
    </Animated.View>
  );
}

/** Everyone detected so far, in order of first appearance; the last to speak glows and ripples. */
export function Seats({ seats }: { seats: Seat[] }) {
  if (seats.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
      {seats.map((s) => (
        <Avatar key={s.name} seat={s} />
      ))}
    </View>
  );
}
