import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { ApiError, api, setAuthToken } from "./api";
import type { User } from "./types";

const TOKEN_KEY = "api_token";

interface AuthValue {
  user: User | null;
  loading: boolean;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAuthToken(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setAuthToken(null);
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      // The API token lives in the OS keystore (Android Keystore / iOS Keychain), not plain storage.
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        setAuthToken(token);
        await refresh();
      }
      setLoading(false);
    })();
  }, [refresh]);

  const signIn = useCallback(async (token: string, u: User) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setAuthToken(token);
    setUser(u);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut, refresh }), [user, loading, signIn, signOut, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
