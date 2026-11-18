import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";

// Dark-first "aurora glass" palette. Solid colours (not translucent) so Android renders stacked cards reliably.
export const colors = {
  ink: "#eef1fb",
  muted: "#a3adc7",
  line: "#2a3358",
  /** Control boundaries (text boxes): 3:1 against the surface, as non-text contrast requires. */
  lineStrong: "#5d6a94",
  success: "#35e0c0",
  surface: "#131a33",
  surfaceStrong: "#1d2650",
  subtle: "#1a2244",
  canvas: "#070b1a",
  brand: "#7c6cf5",
  brandStrong: "#6a59ee",
  brandSoft: "#262a5e",
  accent: "#35e0c0",
  accentSoft: "#0f3a3a",
  danger: "#ff7a85",
  dangerSoft: "#3d1a28",
  warn: "#ffc467",
  warnSoft: "#3a2d12",
  glow: "#8b7cff",
};

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
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
  // brandStrong: white text on it is 4.9:1 (on the lighter brand it was 3.95:1, under the 4.5:1 minimum).
  const bg = { primary: colors.brandStrong, secondary: colors.surface, danger: colors.danger }[variant];
  const fg = variant === "secondary" ? colors.ink : "#fff";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      disabled={props.disabled || props.busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: props.disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "primary" && { shadowColor: colors.glow, shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
        variant === "secondary" && { borderWidth: 1, borderColor: colors.line },
        props.style,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {props.icon ? <Ionicons name={props.icon} size={19} color={fg} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{props.label}</Text>
        </View>
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
    // info is brand-on-brandSoft (3.4:1): fine for large/secondary use, so confirmations use success (7.5:1).
    info: [colors.brandSoft, colors.brand],
    success: [colors.accentSoft, colors.success],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={{ color: fg, fontSize: 14, lineHeight: 20 }}>{children}</Text>
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
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas, padding: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#8b7cff",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  title: { fontSize: 24, fontWeight: "700", color: colors.ink, marginBottom: 6 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink, marginBottom: 6 },
  eyebrow: { fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  button: { minHeight: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  buttonText: { fontSize: 16, fontWeight: "700" },
  banner: { borderRadius: 12, padding: 12, marginBottom: 10 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
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
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={name} size={size * 0.5} color={fg} />
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
        borderBottomWidth: props.last ? 0 : StyleSheet.hairlineWidth,
        borderColor: colors.line,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {props.icon ? <IconBadge name={props.icon} tone={props.tone} size={38} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }} numberOfLines={1}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }} numberOfLines={2}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.trailing ? <Text style={{ fontSize: 13, color: colors.muted }}>{props.trailing}</Text> : null}
      {props.onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

/** Large square-ish tile for the Tools grid. */
export function Tile(props: { icon: IconName; title: string; subtitle: string; onPress: () => void; tone?: "brand" | "accent" | "warn" | "muted" }) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { flex: 1, minHeight: 132, marginBottom: 0, opacity: pressed ? 0.75 : 1 }]}
    >
      <IconBadge name={props.icon} tone={props.tone} size={44} />
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink, marginTop: 12 }}>{props.title}</Text>
      <Text style={{ fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18 }}>{props.subtitle}</Text>
    </Pressable>
  );
}
