import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";

import { ApiError, meetingsApi, type MeetingFilters } from "../../api";
import { Banner, Button, Chip, Muted, colors, styles } from "../../components/ui";
import { MEETING_LANGUAGES, formatClock, isProcessing, meetingLanguageName } from "../../lib/meetings";
import type { MeetingListItem } from "../../types";

const STATUS: Record<string, string> = {
  live: "Live",
  queued: "Queued",
  transcribing: "Transcribing",
  translating: "Translating",
  summarizing: "Summarizing",
  completed: "Ready",
  failed: "Failed",
  draft: "Draft",
};

export default function MeetingsScreen() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<MeetingFilters>({});
  const [items, setItems] = useState<MeetingListItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const res = await meetingsApi.list({ ...filters, page });
        setItems((prev) => (page === 1 ? res.results : [...prev, ...res.results]));
        setNext(res.next ? page + 1 : null);
        setError("");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load meetings");
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => ({ ...f, q: query })), 350);
    return () => clearTimeout(id);
  }, [query]);

  useFocusEffect(
    useCallback(() => {
      void load(1);
    }, [load]),
  );

  // Keep refreshing while anything is still processing.
  useEffect(() => {
    if (!items.some((m) => isProcessing(m.status))) return;
    const id = setInterval(() => void load(1), 4000);
    return () => clearInterval(id);
  }, [items, load]);

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: active ? colors.brand : colors.line, backgroundColor: active ? colors.brandSoft : "#fff" }}
    >
      <Text style={{ fontSize: 13, fontWeight: "600", color: active ? colors.brand : colors.ink }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ padding: 16, paddingBottom: 8, gap: 10 }}>
        <Button label="New meeting" onPress={() => router.push("/meetings/new")} />
        <TextInput
          placeholder="Search titles, transcripts, notes…"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          style={styles.input}
          accessibilityLabel="Search meetings"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {chip("All languages", !filters.language, () => setFilters((f) => ({ ...f, language: "" })))}
          {MEETING_LANGUAGES.map((l) => chip(l.name, filters.language === l.code, () => setFilters((f) => ({ ...f, language: l.code }))))}
          {chip("Ready", filters.status === "completed", () => setFilters((f) => ({ ...f, status: f.status === "completed" ? "" : "completed" })))}
          {chip("Failed", filters.status === "failed", () => setFilters((f) => ({ ...f, status: f.status === "failed" ? "" : "failed" })))}
        </ScrollView>
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>
      <FlatList
        data={items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => void load(1)} />}
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.brand} /> : <Muted style={{ textAlign: "center", marginTop: 24 }}>No meetings yet.</Muted>}
        onEndReached={() => next && !loading && void load(next)}
        renderItem={({ item: m }) => (
          <Pressable onPress={() => router.push(`/meetings/${m.id}`)} style={[styles.card, { marginBottom: 10 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: colors.ink }} numberOfLines={1}>
                {m.title}
              </Text>
              <Chip
                label={`${STATUS[m.status]}${isProcessing(m.status) && m.progress ? ` ${m.progress}%` : ""}`}
                tone={m.status === "failed" ? "warn" : m.status === "completed" ? "accent" : "muted"}
              />
            </View>
            <Muted style={{ marginTop: 4 }}>
              {new Date(m.recorded_at).toLocaleString()} · {formatClock(m.duration_seconds * 1000)} · {meetingLanguageName(m.spoken_language)}
              {m.translation_language ? ` → ${meetingLanguageName(m.translation_language)}` : ""}
              {m.has_summary ? " · Notes" : ""}
            </Muted>
          </Pressable>
        )}
      />
    </View>
  );
}
