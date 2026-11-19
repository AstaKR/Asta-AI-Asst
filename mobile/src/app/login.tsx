import { router } from "expo-router";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { getApiUrl } from "../config";
import { Banner, Button, Card, Field, colors, fonts, Muted, Screen, Title } from "../components/ui";

type Mode = "login" | "register" | "reset";

export default function Login() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  function go(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    setSentTo("");
    setCode("");
    setPassword("");
  }

  const submit = () =>
    run(async () => {
      const { token, ...user } =
        mode === "login"
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password, name.trim() || undefined);
      await signIn(token, user);
      // New accounts land on Settings so they can add a mobile number for calls.
      router.replace(mode === "register" ? "/settings" : "/home");
    }, "Something went wrong");

  const isLogin = mode === "login";
  const link = { color: colors.brand, textAlign: "center" as const, fontFamily: fonts.sansBold, textDecorationLine: "underline" as const };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18, marginTop: 4 }}>
            <Image source={require("../../assets/icon.png")} style={{ width: 54, height: 54, borderRadius: 16, borderWidth: 2.5, borderColor: colors.ink }} accessibilityIgnoresInvertColors />
            <Text style={{ fontSize: 32, fontFamily: fonts.displayBlack, color: colors.ink }}>
              Asta <Text style={{ color: colors.chilliText }}>Talk</Text>
            </Text>
          </View>
          <Title>{isLogin ? "Sign in" : mode === "register" ? "Create your account" : "Reset your password"}</Title>
          <Muted style={{ marginBottom: 16 }}>Use the same username and password as on the website.</Muted>
          {notice ? <Banner tone="info">{notice}</Banner> : null}
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {mode === "reset" ? (
            <Card>
              {!sentTo ? (
                <>
                  <Muted style={{ marginBottom: 12 }}>
                    Enter the mobile number saved in your account Settings. We send a code to it by SMS. If you never added a number, ask an administrator.
                  </Muted>
                  <Field label="Mobile number" placeholder="98765 43210" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} maxLength={16} />
                  <Button
                    label="Send code"
                    busy={busy}
                    disabled={phone.replace(/\D/g, "").length < 10}
                    onPress={() => run(async () => setSentTo((await api.requestPasswordReset(phone)).sent_to), "Could not send the code")}
                  />
                </>
              ) : (
                <>
                  <Muted style={{ marginBottom: 12 }}>If that number belongs to an account, a code was sent to {sentTo}.</Muted>
                  <Field label="6-digit code" keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" value={code} onChangeText={setCode} maxLength={8} />
                  <Field label="New password (8+ characters)" secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" value={password} onChangeText={setPassword} maxLength={128} />
                  <Button
                    label="Set new password"
                    busy={busy}
                    disabled={code.trim().length < 4 || password.length < 8}
                    onPress={() =>
                      run(async () => {
                        await api.confirmPasswordReset(phone, code.trim(), password);
                        go("login");
                        setNotice("Password changed. Sign in with your new password.");
                      }, "Could not reset the password")
                    }
                  />
                  <Button label="Use a different number" variant="secondary" onPress={() => setSentTo("")} style={{ marginTop: 10 }} />
                </>
              )}
              <Pressable onPress={() => go("login")} style={{ marginTop: 14 }}>
                <Text style={link}>Back to sign in</Text>
              </Pressable>
            </Card>
          ) : (
            <Card>
              <Field
                label="Username"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                value={username}
                onChangeText={setUsername}
                maxLength={30}
              />
              {!isLogin ? <Field label="Name shown on calls" value={name} onChangeText={setName} maxLength={60} /> : null}
              <Field
                label="Password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete={isLogin ? "current-password" : "new-password"}
                textContentType={isLogin ? "password" : "newPassword"}
                value={password}
                onChangeText={setPassword}
                maxLength={128}
              />
              <Button
                label={isLogin ? "Sign in" : "Create account"}
                onPress={submit}
                busy={busy}
                disabled={username.trim().length < 3 || password.length < (isLogin ? 1 : 8)}
              />
              {isLogin ? (
                <Pressable onPress={() => go("reset")} style={{ marginTop: 14 }}>
                  <Text style={link}>Forgot password?</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => go(isLogin ? "register" : "login")} style={{ marginTop: 14 }}>
                <Text style={link}>{isLogin ? "New here? Create an account" : "Already have an account? Sign in"}</Text>
              </Pressable>
            </Card>
          )}
          <Pressable
            onPress={() => router.push("/server")}
            style={{ marginTop: 10, minHeight: 48, alignItems: "center", justifyContent: "center" }}
            accessibilityRole="button"
            accessibilityLabel={`Server ${getApiUrl().replace(/^https?:\/\//, "")}. Change server`}
          >
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              Server: {getApiUrl().replace(/^https?:\/\//, "")} · <Text style={{ color: colors.brand }}>Change</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
