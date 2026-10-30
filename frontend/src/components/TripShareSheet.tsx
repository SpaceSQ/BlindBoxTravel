import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";

import { QrMark } from "./QrMark";
import { errorMessage, useToast } from "./Toast";
import {
  familyShareActions,
  fillShareText,
  messagesUrl,
  playShareActions,
  POSTER_TEMPLATES,
  whatsAppUrl,
  type PosterTemplate,
  type ShareActionId,
} from "../shareActions";
import {
  facebookPostUrl,
  openExternal,
  saveTripPoster,
  shareStoryImage,
  shareToWeChat,
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
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [template, setTemplate] = useState<PosterTemplate>("classic");
  const posterRef = useRef<View>(null);
  const link = token ? tripPageUrl(token) : "";
  const standard = token ? tripShareMessage(place, token) : place;
  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      showToast(errorMessage(error));
    }
  }

  function textFor(id: ShareActionId): string {
    if (id === "challenge") {
      return t("share.challengeBody");
    }
    if (id === "remix") {
      return fillShareText(t("share.remixBody"), { place, link });
    }
    if (id === "duet") {
      return fillShareText(t("share.duetBody"), { place, link });
    }
    if (id === "reveal") {
      return fillShareText(t("share.revealBody"), { link });
    }
    return standard;
  }

  async function onAction(id: ShareActionId) {
    if (id === "x") {
      await openExternal(xPostUrl(standard));
      return;
    }
    if (id === "facebook") {
      await openExternal(facebookPostUrl(link || standard));
      return;
    }
    if (id === "system") {
      await Share.share({ message: standard });
      return;
    }
    if (id === "messages") {
      await openExternal(messagesUrl(standard, Platform.OS));
      return;
    }
    if (id === "whatsapp") {
      await openExternal(whatsAppUrl(standard));
      return;
    }
    if (id === "wechat") {
      const opened = await shareToWeChat(standard);
      showToast(opened ? t("share.wechatOpened") : t("share.wechatCopied"));
      return;
    }
    if (id === "save") {
      await saveTripPoster(posterRef.current, { place, lines, link });
      showToast(t("share.saved"));
      return;
    }
    if (id === "story") {
      await shareStoryImage(posterRef.current);
      return;
    }
    const message = textFor(id);
    await Clipboard.setStringAsync(message);
    await Share.share({ message });
    showToast(t("share.copied"));
  }

  const posterStyle = template === "sticker" ? styles.sticker : template === "postcard" ? styles.postcard : styles.classic;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("common.close")} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.head}>
              <Text style={styles.title}>{t("share.sheetTitle")}</Text>
              <Pressable onPress={onClose} accessibilityRole="button">
                <Text style={styles.close}>{t("common.close")}</Text>
              </Pressable>
            </View>
            <Text style={styles.templatesLabel}>{t("share.templates")}</Text>
            <View style={styles.templates}>
              {POSTER_TEMPLATES.map((item) => {
                const selected = item === template;
                return (
                  <Pressable
                    key={item}
                    onPress={() => setTemplate(item)}
                    style={[styles.templateChip, selected && styles.templateChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.templateText, selected && styles.templateTextOn]}>{t(`share.template.${item}`)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View ref={posterRef} collapsable={false} style={[styles.poster, posterStyle]}>
              <Text style={[styles.brand, template === "sticker" && styles.brandLight]}>Mystery Getaway</Text>
              {template === "postcard" ? <Text style={styles.stamp}>{t("share.stamp")}</Text> : null}
              <Text style={[styles.place, template === "sticker" && styles.placeLight]}>{place}</Text>
              {lines.map((line) => (
                <Text key={line} style={[styles.line, template === "sticker" && styles.lineLight]}>
                  {line}
                </Text>
              ))}
              {link && template !== "sticker" ? <QrMark value={link} size={120} /> : null}
              <Text style={[styles.scan, template === "sticker" && styles.lineLight]}>{t("share.scan")}</Text>
            </View>
            <Text style={styles.group}>{t("share.forFamily")}</Text>
            <View style={styles.actions}>
              {familyShareActions(i18n.language).map((id) => (
                <Pressable
                  key={id}
                  onPress={() => void run(() => onAction(id))}
                  style={[styles.action, styles.actionPrimary, id === "save" && styles.save]}
                  accessibilityRole="button"
                  accessibilityLabel={id === "save" ? t("share.saveCard") : t(`share.action.${id}`)}
                >
                  <Text style={[styles.actionText, id === "save" && styles.saveText]}>
                    {id === "save" ? t("share.saveCard") : t(`share.action.${id}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.group}>{t("share.forPlay")}</Text>
            <Text style={styles.groupHint}>{t("share.duetHint")}</Text>
            <View style={styles.actions}>
              {playShareActions(i18n.language).map((id) => (
                <Pressable
                  key={id}
                  onPress={() => void run(() => onAction(id))}
                  style={styles.action}
                  accessibilityRole="button"
                  accessibilityLabel={t(`share.action.${id}`)}
                >
                  <Text style={styles.actionText}>{t(`share.action.${id}`)}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(31, 26, 23, 0.35)" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: theme.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.ink, fontSize: 20, fontWeight: "700" },
  close: { color: theme.accent, fontWeight: "700" },
  templatesLabel: { color: theme.muted, fontSize: 13, fontWeight: "600" },
  templates: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  templateChip: {
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.bg,
  },
  templateChipOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  templateText: { color: theme.ink, fontWeight: "700" },
  templateTextOn: { color: theme.white },
  poster: { borderRadius: 18, padding: 16, gap: 8, alignItems: "center" },
  classic: { backgroundColor: theme.bg },
  postcard: { backgroundColor: "#fffaf3", borderWidth: 2, borderColor: theme.accent, borderStyle: "dashed" },
  sticker: { backgroundColor: "#1f1a17" },
  brand: { color: theme.muted, fontSize: 13, fontWeight: "700", alignSelf: "flex-start" },
  brandLight: { color: "#f6f3ee" },
  stamp: {
    position: "absolute",
    top: 12,
    right: 12,
    color: theme.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  place: { color: theme.ink, fontSize: 22, fontWeight: "700", alignSelf: "flex-start" },
  placeLight: { color: theme.white },
  line: { color: theme.muted, fontSize: 14, alignSelf: "flex-start" },
  lineLight: { color: "#f6f3ee" },
  scan: { color: theme.muted, fontSize: 13, lineHeight: 18, textAlign: "center" },
  group: { color: theme.ink, fontSize: 16, fontWeight: "700" },
  groupHint: { color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: -6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
    justifyContent: "center",
  },
  actionPrimary: { minHeight: 52, paddingVertical: 12 },
  actionText: { color: theme.ink, fontWeight: "700", fontSize: 16 },
  save: { backgroundColor: theme.ink, borderColor: theme.ink },
  saveText: { color: theme.white },
});
