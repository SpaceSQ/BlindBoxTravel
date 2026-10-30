import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { QrMark } from "./QrMark";
import { errorMessage, useToast } from "./Toast";
import {
  facebookPostUrl,
  openExternal,
  saveTripPoster,
  shareInvite,
  tripPageUrl,
  tripShareMessage,
  xPostUrl,
} from "../sharing";
import { theme } from "../theme";

type Props = {
  visible: boolean;
  place: string;
  lines: string[];
  token: string;
  onClose: () => void;
};

export function TripShareSheet({ visible, place, lines, token, onClose }: Props) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const posterRef = useRef<View>(null);
  const link = token ? tripPageUrl(token) : "";

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      showToast(errorMessage(error));
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{t("share.sheetTitle")}</Text>
          <View ref={posterRef} collapsable={false} style={styles.poster}>
            <Text style={styles.brand}>Mystery Getaway</Text>
            <Text style={styles.place}>{place}</Text>
            {lines.map((line) => (
              <Text key={line} style={styles.line}>
                {line}
              </Text>
            ))}
            {link ? <QrMark value={link} /> : null}
            <Text style={styles.scan}>{t("share.scan")}</Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={() => void run(() => openExternal(xPostUrl(tripShareMessage(place, token))))}
              style={styles.action}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>{t("share.x")}</Text>
            </Pressable>
            <Pressable
              onPress={() => void run(() => openExternal(facebookPostUrl(link)))}
              style={styles.action}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>{t("share.facebook")}</Text>
            </Pressable>
            <Pressable
              onPress={() => void run(() => shareInvite({ token }))}
              style={styles.action}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>{t("share.more")}</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                void run(async () => {
                  await saveTripPoster(posterRef.current, { place, lines, link });
                  showToast(t("share.saved"));
                })
              }
              style={styles.save}
              accessibilityRole="button"
            >
              <Text style={styles.saveText}>{t("share.saveImage")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(31, 26, 23, 0.35)" },
  sheet: {
    backgroundColor: theme.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    gap: 14,
  },
  title: { color: theme.ink, fontSize: 20, fontWeight: "700" },
  poster: {
    backgroundColor: theme.bg,
    borderRadius: 18,
    padding: 16,
    gap: 8,
    alignItems: "center",
  },
  brand: { color: theme.muted, fontSize: 13, fontWeight: "700", alignSelf: "flex-start" },
  place: { color: theme.ink, fontSize: 22, fontWeight: "700", alignSelf: "flex-start" },
  line: { color: theme.muted, fontSize: 14, alignSelf: "flex-start" },
  scan: { color: theme.muted, fontSize: 13, lineHeight: 18, textAlign: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
  },
  actionText: { color: theme.ink, fontWeight: "700" },
  save: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.ink,
  },
  saveText: { color: theme.white, fontWeight: "700" },
});
