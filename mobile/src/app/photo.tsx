import * as Clipboard from "expo-clipboard";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";

import { ApiError, assistantApi, quickApi } from "../api";
import { Banner, Button, Card, Muted, Screen, colors, styles } from "../components/ui";
import { useQuickTranslate } from "../hooks/useQuickTranslate";
import { MEETING_LANGUAGES } from "../lib/meetings";
import type { PhotoTranslation } from "../types";

// Text stays readable at this size, and smaller images cost fewer AI tokens.
const MAX_EDGE = 1600;

/** Photograph or pick an image (sign, menu, letter, screenshot) and translate the text in it. */
export default function PhotoTranslateScreen() {
  const [language, setLanguage] = useState("en");
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<PhotoTranslation | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const audio = useQuickTranslate();

  async function pick(source: "camera" | "library") {
    setError("");
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError("Camera permission is required. Enable it in Settings → Apps.");
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, allowsEditing: true };
    const picked = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setBusy("Reading the text…");
    setResult(null);
    try {
      const ctx = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > MAX_EDGE) {
        ctx.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
      }
      const image = await (await ctx.renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
      setPreview(image.uri);
      setResult(await assistantApi.image({ uri: image.uri, name: "photo.jpg", type: "image/jpeg" }, language));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not translate the photo.");
    } finally {
      setBusy("");
    }
  }

  const allText = result?.lines.map((l) => l.translation).join("\n") ?? "";

  async function listen() {
    setBusy("Preparing voice…");
    setError("");
    try {
      const r = await quickApi.text({ text: allText.slice(0, 1000), source_language: language, target_language: language, speak: true });
      await audio.play(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not play the translation.");
    } finally {
      setBusy("");
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <Card>
          <Text style={styles.label}>Translate into</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {MEETING_LANGUAGES.map((l) => (
              <Pressable
                key={l.code}
                onPress={() => setLanguage(l.code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: language === l.code }}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: language === l.code ? colors.brand : colors.line, backgroundColor: language === l.code ? colors.brandSoft : "#fff" }}
              >
                <Text style={{ fontWeight: "600", color: language === l.code ? colors.brand : colors.ink }}>{l.native}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Button label="Take photo" icon="camera" onPress={() => void pick("camera")} disabled={Boolean(busy)} style={{ flex: 1 }} />
            <Button label="Gallery" icon="images-outline" variant="secondary" onPress={() => void pick("library")} disabled={Boolean(busy)} style={{ flex: 1 }} />
          </View>
          <Muted style={{ marginTop: 8, fontSize: 12 }}>
            Signs, menus, letters, forms or screenshots. The image is sent to Claude (Anthropic) to read; it is not stored.
          </Muted>
        </Card>

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {busy ? <Muted style={{ textAlign: "center", marginVertical: 8 }}>{busy}</Muted> : null}

        {preview && <Image source={{ uri: preview }} style={{ width: "100%", height: 200, borderRadius: 14, marginBottom: 12 }} resizeMode="contain" />}

        {result && (
          <Card>
            <Muted style={{ fontSize: 12 }}>
              {result.summary}
              {result.detected_language ? ` · ${result.detected_language}` : ""}
            </Muted>
            {result.lines.length === 0 && <Text style={{ marginTop: 8, color: colors.ink }}>No readable text was found in this image.</Text>}
            {result.lines.map((l, i) => (
              <View key={i} style={{ paddingVertical: 8, borderBottomWidth: i < result.lines.length - 1 ? 1 : 0, borderColor: colors.line }}>
                <Text style={{ color: colors.muted }}>{l.original}</Text>
                <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "600", marginTop: 2 }} selectable>
                  {l.translation}
                </Text>
              </View>
            ))}
            {result.lines.length > 0 && (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <Button label="Listen" icon="volume-high-outline" variant="secondary" onPress={() => void listen()} disabled={Boolean(busy)} style={{ flex: 1, minHeight: 40 }} />
                <Button label="Copy all" icon="copy-outline" variant="secondary" onPress={() => void Clipboard.setStringAsync(allText)} style={{ flex: 1, minHeight: 40 }} />
              </View>
            )}
            <Muted style={{ marginTop: 10, fontSize: 12 }}>AI translations can be wrong — check important details.</Muted>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
