import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { planApi } from "../api";
import type { MyPlan } from "../types";
import { Card, Chip, Muted, colors, styles } from "./ui";

function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const state = pct >= 100 ? "Limit reached" : pct >= 80 ? "Almost used" : "";
  const bar = pct >= 100 ? colors.danger : pct >= 80 ? colors.warn : colors.brand;
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{label}</Text>
        <Muted style={{ fontSize: 13 }}>
          {Math.round(used * 10) / 10} / {limit} {unit}
        </Muted>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.subtle, marginTop: 6, overflow: "hidden" }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
        <View style={{ height: 6, width: `${pct}%`, backgroundColor: bar }} />
      </View>
      {state ? <Text style={{ fontSize: 12, color: bar, marginTop: 3 }}>{state}</Text> : null}
    </View>
  );
}

/** The user's plan and today's usage against it. */
export function PlanCard() {
  const [data, setData] = useState<MyPlan | null>(null);
  useFocusEffect(
    useCallback(() => {
      planApi.mine().then(setData).catch(() => undefined);
    }, []),
  );
  if (!data?.plan) return null;
  const { plan, usage } = data;
  return (
    <Card>
      <Text style={styles.eyebrow}>Your plan</Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink }}>
          {plan.name} <Text style={{ fontSize: 14, fontWeight: "500", color: colors.muted }}>₹{plan.price_inr_month}/month</Text>
        </Text>
        {data.unlimited ? <Chip label="Admin · no limits" tone="brand" /> : null}
      </View>
      <Meter label="Call minutes today" used={usage.call_minutes_today} limit={plan.daily_call_minutes} unit="min" />
      <Meter label="Assistant today" used={usage.assistant_requests_today} limit={plan.daily_assistant_requests} unit="" />
      <Meter label="Meetings this month" used={usage.meeting_minutes_this_month} limit={plan.monthly_meeting_minutes} unit="min" />
      {plan.phone_calls ? <Meter label="Phone calls today" used={usage.phone_calls_today} limit={plan.daily_phone_calls} unit="" /> : null}
      {!data.payments ? <Muted style={{ fontSize: 12, marginTop: 10 }}>To change plan, contact your administrator.</Muted> : null}
    </Card>
  );
}
