import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";

// "Chai stall" palette, the same one the website uses: warm paper, ink outlines with hard offset shadows,
// saffron actions, indigo links, chilli red accents. Solid colours only, so Android renders stacked cards reliably.
export const colors = {
  ink: "#1c1712",
  muted: "#5a5046",
  line: "#d8cbb3",
  /** Control boundaries (text boxes): the ink colour, as on the website. */
  lineStrong: "#1c1712",
  success: "#0f6b5c",
  surface: "#fffaf0",
  surfaceStrong: "#ecdfc6",
  subtle: "#efe4cf",
  canvas: "#f5ecdc",
  brand: "#1f2d6e",
  brandStrong: "#16215a",
  brandSoft: "#dfdfee",
  accent: "#0f6b5c",
  accentSoft: "#d3e4dc",
  danger: "#a8231b",
  dangerSoft: "#f3d9d2",
  warn: "#8a4b06",
  warnSoft: "#f2e0bd",
  /** The action colour: buttons and highlights. Text on it is always ink. */
  saffron: "#f5a623",
  saffronDeep: "#e08a00",
  chilli: "#d6402a",
  chilliText: "#aa2f1b",
  /** Kept for older screens; it is now the saffron highlight. */
  glow: "#f5a623",
};

/** Font families loaded in the root layout. Falls back to the system font until they are ready. */
export const fonts = {
  display: "Fraunces_700Bold",
  displayBlack: "Fraunces_900Black",
  sans: "InstrumentSans_500Medium",
  sansBold: "InstrumentSans_700Bold",
};

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

/**
 * A paper card with an ink outline and a hard offset shadow, like a sticker. The shadow is a second rounded box
 * behind the card (React Native cannot draw a sharp shadow), so it looks the same on every Android version.
 */
export function Sticker({
  children,
  style,
  radius = 22,
  offset = 4,
  bg = colors.surface,
  shadow = colors.ink,
  pressed = false,
  outer,
}: {
  children: ReactNode;
  style?: ViewStyle;
  radius?: number;
  offset?: number;
  bg?: string;
  shadow?: string;
  pressed?: boolean;
  outer?: ViewStyle;
}) {
  const shift = pressed ? Math.min(2, offset) : 0;
  return (
    <View style={[{ marginRight: offset, marginBottom: offset }, outer]}>
      <View style={{ position: "absolute", left: offset - shift, top: offset - shift, right: -offset + shift, bottom: -offset + shift, borderRadius: radius, backgroundColor: shadow }} />
      <View
        style={[
          { backgroundColor: bg, borderWidth: 2.5, borderColor: colors.ink, borderRadius: radius, transform: [{ translateX: shift }, { translateY: shift }] },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  // Padding and margins live on the inner box; Card keeps its old bottom spacing.
  return (
    <Sticker style={{ padding: 16, ...style }} outer={{ marginBottom: 14 }}>
      {children}
    </Sticker>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

type Variant = "primary" | "secondary" | "danger";

export function Button(props: { label: string; onPress: () => void; variant?: Variant; disabled?: boolean; busy?: boolean; style?: ViewStyle; icon?: IconName }) {
  const variant = props.variant ?? "primary";
  const bg = { primary: colors.saffron, secondary: colors.surface, danger: colors.chilliText }[variant];
  const fg = variant === "danger" ? "#fff" : colors.ink;
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} disabled={props.disabled || props.busy} style={[{ opacity: props.disabled ? 0.5 : 1 }, props.style]}>
      {({ pressed }) => (
        <Sticker bg={bg} radius={999} offset={3} pressed={pressed} style={{ minHeight: 50, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 }}>
          {props.busy ? (
            <ActivityIndicator color={fg} />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {props.icon ? <Ionicons name={props.icon} size={19} color={fg} /> : null}
              <Text style={[styles.buttonText, { color: fg }]}>{props.label}</Text>
            </View>
          )}
        </Sticker>
      )}
    </Pressable>
  );
}

/** Labelled text box. `hint` is always-visible help; `error` shows under the box and is announced. */
export function Field(props: TextInputProps & { label: string; hint?: string; error?: string }) {
  const { label, hint, error, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        accessibilityHint={hint}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        {...rest}
      />
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6, lineHeight: 18 }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Banner({ tone, children }: { tone: "warn" | "danger" | "info" | "success"; children: ReactNode }) {
  const map = {
    warn: [colors.warnSoft, colors.warn],
    danger: [colors.dangerSoft, colors.danger],
    info: [colors.brandSoft, colors.brand],
    success: [colors.accentSoft, colors.success],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.banner, { backgroundColor: bg, borderColor: fg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={{ color: fg, fontSize: 14, lineHeight: 20, fontFamily: fonts.sans }}>{children}</Text>
    </View>
  );
}

export function Chip({ label, tone = "muted" }: { label: string; tone?: "muted" | "brand" | "accent" | "warn" | "danger" }) {
  const map = {
    muted: [colors.subtle, colors.muted],
    brand: [colors.brandSoft, colors.brand],
    accent: [colors.accentSoft, colors.accent],
    warn: [colors.warnSoft, colors.warn],
    danger: [colors.dangerSoft, colors.danger],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.chip, { backgroundColor: bg, borderColor: fg }]}>
      <Text style={{ color: fg, fontSize: 12, fontFamily: fonts.sansBold }}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas, padding: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 2.5,
    borderColor: colors.ink,
    padding: 16,
    marginBottom: 14,
  },
  title: { fontSize: 26, fontFamily: fonts.display, color: colors.ink, marginBottom: 6 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20, fontFamily: fonts.sans },
  label: { fontSize: 14, fontFamily: fonts.sansBold, color: colors.ink, marginBottom: 6 },
  eyebrow: { fontSize: 12, fontFamily: fonts.sansBold, color: colors.chilliText, letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 8 },
  input: {
    borderWidth: 2.5,
    borderColor: colors.ink,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  button: { minHeight: 50, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  buttonText: { fontSize: 16, fontFamily: fonts.sansBold },
  banner: { borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1.5 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start", borderWidth: 1.5 },
});

/** Section title above a group of cards or rows. */
export function SectionHeader({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.eyebrow, { marginTop: 8 }, style]}>{children}</Text>;
}

/** Rounded icon square used at the start of list rows and tiles. */
export function IconBadge({ name, tone = "brand", size = 40 }: { name: IconName; tone?: "brand" | "accent" | "warn" | "danger" | "muted"; size?: number }) {
  const map = {
    brand: [colors.brandSoft, colors.brand],
    accent: [colors.accentSoft, colors.accent],
    warn: [colors.warnSoft, colors.warn],
    danger: [colors.dangerSoft, colors.danger],
    muted: [colors.subtle, colors.muted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.34, backgroundColor: bg, borderWidth: 2, borderColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={name} size={size * 0.5} color={fg} />
    </View>
  );
}

/** A round initial for a person: the same colour every time for the same name. */
const AVATARS = ["#f5a623", "#d6402a", "#8fa2ff", "#5fd3b5", "#ff8fc0", "#c9b458"];
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const letter = ([...name.trim()][0] ?? "?").toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: AVATARS[h % AVATARS.length], borderWidth: 2.5, borderColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: fonts.display, fontSize: size * 0.44, color: colors.ink }}>{letter}</Text>
    </View>
  );
}

/** A tappable row: icon, title, optional subtitle and trailing text, chevron. */
export function ListItem(props: {
  icon?: IconName;
  tone?: "brand" | "accent" | "warn" | "danger" | "muted";
  title: string;
  subtitle?: string;
  trailing?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!props.onPress}
      accessibilityRole={props.onPress ? "button" : undefined}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: props.last ? 0 : StyleSheet.hairlineWidth * 2,
        borderColor: colors.line,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {props.icon ? <IconBadge name={props.icon} tone={props.tone} size={38} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontFamily: fonts.sansBold, color: colors.ink }} numberOfLines={1}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2, fontFamily: fonts.sans }} numberOfLines={2}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.trailing ? <Text style={{ fontSize: 13, color: colors.muted, fontFamily: fonts.sans }}>{props.trailing}</Text> : null}
      {props.onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

const TILE_BG = { brand: colors.brandSoft, accent: colors.accentSoft, warn: "#f9e3b3", muted: colors.surface } as const;

/** Large tile for the Tools grid. */
export function Tile(props: { icon: IconName; title: string; subtitle: string; onPress: () => void; tone?: "brand" | "accent" | "warn" | "muted" }) {
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" style={{ flex: 1 }}>
      {({ pressed }) => (
        <Sticker bg={TILE_BG[props.tone ?? "muted"]} pressed={pressed} style={{ minHeight: 132, padding: 14 }}>
          <IconBadge name={props.icon} tone={props.tone} size={44} />
          <Text style={{ fontSize: 18, fontFamily: fonts.display, color: colors.ink, marginTop: 12 }}>{props.title}</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18, fontFamily: fonts.sans }}>{props.subtitle}</Text>
        </Sticker>
      )}
    </Pressable>
  );
}
