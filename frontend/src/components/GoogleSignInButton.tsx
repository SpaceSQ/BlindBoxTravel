import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";

WebBrowser.maybeCompleteAuthSession();

const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined;
const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || undefined;
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined;
const configured = Boolean(iosClientId || androidClientId || webClientId);
const placeholderClientId = "000000000000-placeholder.apps.googleusercontent.com";

type Props = {
  disabled: boolean;
  ensureAgreed: () => boolean;
  onMissing: () => void;
  onToken: (identityToken: string) => void;
  onMissingToken: () => void;
};

export function GoogleSignInButton({ disabled, ensureAgreed, onMissing, onToken, onMissingToken }: Props) {
  const { t } = useTranslation();
  const onTokenRef = useRef(onToken);
  const onMissingTokenRef = useRef(onMissingToken);
  onTokenRef.current = onToken;
  onMissingTokenRef.current = onMissingToken;
  const [, response, promptAsync] = Google.useAuthRequest({
    iosClientId: iosClientId ?? placeholderClientId,
    androidClientId: androidClientId ?? placeholderClientId,
    webClientId: webClientId ?? placeholderClientId,
  });

  useEffect(() => {
    if (response?.type !== "success") {
      return;
    }
    const idToken = response.authentication?.idToken ?? response.params.id_token;
    if (typeof idToken === "string" && idToken.length > 0) {
      onTokenRef.current(idToken);
      return;
    }
    onMissingTokenRef.current();
  }, [response]);

  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        if (!ensureAgreed()) {
          return;
        }
        if (!configured) {
          onMissing();
          return;
        }
        void promptAsync();
      }}
      style={styles.button}
      accessibilityRole="button"
    >
      <Ionicons name="logo-google" size={18} color="#1f1f1f" />
      <Text style={styles.label}>{t("account.signInGoogle")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dadce0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  label: { color: "#1f1f1f", fontSize: 17, fontWeight: "700" },
});
