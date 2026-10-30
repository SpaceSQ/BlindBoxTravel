import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { theme } from "../theme";

export type AgreementDoc = "terms" | "privacy";

type Props = {
  doc: AgreementDoc | null;
  onClose: () => void;
};

export function AgreementModal({ doc, onClose }: Props) {
  const { t } = useTranslation();
  const page = doc
    ? {
        title: t(doc === "terms" ? "agreements.termsTitle" : "agreements.privacyTitle"),
        body: t(doc === "terms" ? "agreements.terms" : "agreements.privacy"),
      }
    : null;
  return (
    <Modal visible={page != null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{page?.title}</Text>
          <ScrollView>
            <Text style={styles.body}>{page?.body}</Text>
          </ScrollView>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button">
            <Text style={styles.closeText}>{t("agreements.read")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(31, 26, 23, 0.35)" },
  sheet: {
    maxHeight: "78%",
    backgroundColor: theme.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
  },
  title: { color: theme.ink, fontSize: 22, fontWeight: "700" },
  body: { color: theme.ink, fontSize: 15, lineHeight: 24 },
  close: {
    height: 48,
    borderRadius: 14,
    backgroundColor: theme.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: theme.white, fontWeight: "700" },
});
