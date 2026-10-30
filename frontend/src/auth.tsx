import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ApiError, fetchAccount, loginAccount, loginDev, loginWithApple, loginWithGoogle, registerAccount, setAuthToken, type AccountUser } from "./api";
import i18n from "./i18n";

const STORAGE_KEY = "blindbox.session";

type AuthContextValue = {
  user: AccountUser | null;
  ready: boolean;
  refresh: () => Promise<void>;
  signIn: (phone: string, password: string) => Promise<void>;
  signUp: (phone: string, password: string, nickname: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInAsDev: () => Promise<void>;
  signInWithGoogle: (identityToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: AccountUser | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const account = await fetchAccount();
    setUser(account.user);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const token = await AsyncStorage.getItem(STORAGE_KEY);
      setAuthToken(token);
      if (!token) {
        if (!cancelled) {
          setReady(true);
        }
        return;
      }
      try {
        const account = await fetchAccount();
        if (!cancelled) {
          setUser(account.user);
        }
      } catch {
        setAuthToken(null);
        await AsyncStorage.removeItem(STORAGE_KEY);
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback(async (token: string, next: AccountUser) => {
    setAuthToken(token);
    await AsyncStorage.setItem(STORAGE_KEY, token);
    setUser(next);
  }, []);

  const signIn = useCallback(
    async (phone: string, password: string) => {
      const result = await loginAccount({ phone, password });
      await adopt(result.token, result.user);
    },
    [adopt],
  );

  const signUp = useCallback(
    async (phone: string, password: string, nickname: string) => {
      const result = await registerAccount({ phone, password, nickname });
      await adopt(result.token, result.user);
    },
    [adopt],
  );

  const signInAsDev = useCallback(async () => {
    if (!__DEV__) {
      return;
    }
    const result = await loginDev();
    await adopt(result.token, result.user);
  }, [adopt]);

  const signInWithApple = useCallback(async () => {
    const AppleAuthentication = await import("expo-apple-authentication");
    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
      throw new ApiError(i18n.t("auth.appleDevice"), 0, null);
    }
    let credential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ERR_REQUEST_CANCELED") {
        return;
      }
      throw error;
    }
    if (!credential.identityToken) {
      throw new ApiError(i18n.t("auth.appleToken"), 0, null);
    }
    const name = credential.fullName;
    const nickname = [name?.familyName, name?.givenName].filter((part) => part && part.trim()).join("");
    const result = await loginWithApple({ identity_token: credential.identityToken, nickname });
    await adopt(result.token, result.user);
  }, [adopt]);

  const signInWithGoogle = useCallback(
    async (identityToken: string) => {
      const result = await loginWithGoogle({ identity_token: identityToken });
      await adopt(result.token, result.user);
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({ user, ready, refresh, signIn, signUp, signInWithApple, signInAsDev, signInWithGoogle, signOut, setUser }),
    [ready, refresh, signIn, signInAsDev, signInWithApple, signInWithGoogle, signOut, signUp, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
