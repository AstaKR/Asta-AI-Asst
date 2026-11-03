import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";

import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { Banner, Button, Card, Field, Muted, Screen, Title } from "../components/ui";

export default function Login() {
  const { signIn } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [sentTo, setSentTo] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      const res = await api.requestOtp(phone);
      setSentTo(res.sent_to);
      setResendIn(res.resend_in);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the code");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError("");
    try {
      const res = await api.verifyOtp(phone, code.trim(), name.trim() || undefined);
      await signIn(res.token, res.user);
      router.replace("/home");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify the code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Title>Sign in with your mobile number</Title>
          <Muted style={{ marginBottom: 16 }}>We send a one-time code by SMS. Your number identifies you for calls.</Muted>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Card>
            {step === "phone" ? (
              <>
                <Field
                  label="Mobile number"
                  placeholder="98765 43210"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  value={phone}
                  onChangeText={setPhone}
                  maxLength={16}
                />
                <Text style={{ color: "#64748b", fontSize: 12, marginBottom: 12 }}>Indian numbers (+91) only for now.</Text>
                <Button label="Send code" onPress={sendCode} busy={busy} disabled={phone.replace(/\D/g, "").length < 10} />
              </>
            ) : (
              <>
                <Muted style={{ marginBottom: 12 }}>Code sent to {sentTo}.</Muted>
                <Field
                  label="6-digit code"
                  placeholder="123456"
                  keyboardType="number-pad"
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  value={code}
                  onChangeText={setCode}
                  maxLength={8}
                />
                <Field label="Your name (shown on calls, first time only)" value={name} onChangeText={setName} maxLength={60} />
                <Button label="Verify and continue" onPress={verify} busy={busy} disabled={code.trim().length < 4} />
                <Button
                  label={resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                  variant="secondary"
                  onPress={sendCode}
                  disabled={resendIn > 0 || busy}
                  style={{ marginTop: 10 }}
                />
                <Button label="Change number" variant="secondary" onPress={() => setStep("phone")} style={{ marginTop: 10 }} />
              </>
            )}
          </Card>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
