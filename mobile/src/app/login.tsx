import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from "react-native";

import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { Banner, Button, Card, Field, Muted, Screen, Title } from "../components/ui";

export default function Login() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const { token, ...user } =
        mode === "login"
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password, name.trim() || undefined);
      await signIn(token, user);
      router.replace("/home");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Title>{isLogin ? "Sign in" : "Create your account"}</Title>
          <Muted style={{ marginBottom: 16 }}>Use the same username and password as on the website.</Muted>
          {error ? <Banner tone="danger">{error}</Banner> : null}
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
            <Pressable onPress={() => { setMode(isLogin ? "register" : "login"); setError(""); }} style={{ marginTop: 14 }}>
              <Text style={{ color: "#2563eb", textAlign: "center" }}>
                {isLogin ? "New here? Create an account" : "Already have an account? Sign in"}
              </Text>
            </Pressable>
          </Card>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
