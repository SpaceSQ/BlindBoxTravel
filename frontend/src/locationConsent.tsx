import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";

import { theme } from "./theme";

const STORAGE_KEY = "mysterygetaway.locationNotice";

type Waiter = (accepted: boolean) => void;

let open = false;
let waiter: Waiter | null = null;
const listeners = new Set<(visible: boolean) => void>();

function publish(visible: boolean) {
  open = visible;
  listeners.forEach((listener) => listener(visible));
}

export function subscribeLocationNotice(listener: (visible: boolean) => void): () => void {
  listeners.add(listener);
  listener(open);
  return () => {
    listeners.delete(listener);
  };
}

export async function ensureLocationNotice(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored === "1") {
    return true;
  }
  if (waiter) {
    const previous = waiter;
    return new Promise((resolve) => {
      waiter = (accepted) => {
        previous(accepted);
        resolve(accepted);
      };
    });
  }
  return new Promise((resolve) => {
    waiter = resolve;
    publish(true);
  });
}

export function acceptLocationNotice() {
  void AsyncStorage.setItem(STORAGE_KEY, "1");
  publish(false);
  waiter?.(true);
  waiter = null;
}

export function dismissLocationNotice() {
  publish(false);
  waiter?.(false);
  waiter = null;
}

export function LocationPrivacyModal() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(open);

  useEffect(() => subscribeLocationNotice(setVisible), []);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissLocationNotice}>
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.title}>{t("privacyNotice.title")}</Text>
          <Text style={styles.body}>{t("privacyNotice.body")}</Text>
          <Pressable onPress={acceptLocationNotice} style={styles.button} accessibilityRole="button">
            <Text style={styles.buttonText}>{t("privacyNotice.accept")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "rgba(28, 22, 18, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: theme.card,
    borderRadius: 20,
    padding: 22,
    gap: 14,
  },
  title: { color: theme.ink, fontSize: 22, fontWeight: "700" },
  body: { color: theme.ink, fontSize: 16, lineHeight: 24 },
  button: {
    height: 52,
    borderRadius: 14,
    backgroundColor: theme.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: theme.white, fontSize: 16, fontWeight: "700" },
});
