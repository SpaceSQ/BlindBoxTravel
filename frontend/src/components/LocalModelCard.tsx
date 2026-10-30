import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { CURRENT_APP } from "../localLlm/constants";
import { getLocalModelController, type LocalModelController } from "../localLlm/controller";
import type { LocalModelSnapshot } from "../localLlm/types";
import { theme } from "../theme";

function useLocalModel(): {
  snapshot: LocalModelSnapshot;
  controller: LocalModelController;
} {
  const controller = getLocalModelController();
  const [snapshot, setSnapshot] = useState(controller.snapshot);
  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  useEffect(() => {
    void controller.probe();
  }, [controller]);
  return { snapshot, controller };
}

function hostLabel(snapshot: LocalModelSnapshot, thisApp: string): string {
  if (snapshot.hostAppId === CURRENT_APP.id) {
    return thisApp;
  }
  return snapshot.hostDisplayName ?? thisApp;
}

export function LocalModelCard({ compact = false, onOpenSettings }: { compact?: boolean; onOpenSettings?: () => void }) {
  const { t } = useTranslation();
  const { snapshot, controller } = useLocalModel();
  const percent = snapshot.progress == null ? null : Math.min(100, Math.round(snapshot.progress * 100));
  const host = hostLabel(snapshot, t("localLlm.thisApp"));

  let status = t("localLlm.scanning");
  if (snapshot.phase === "ready" && snapshot.shared) {
    status = t("localLlm.mountedShared", { host });
  } else if (snapshot.phase === "ready") {
    status = t("localLlm.mountedOwn", { host });
  } else if (snapshot.phase === "downloading") {
    status = percent == null ? t("localLlm.downloading") : t("localLlm.progress", { percent });
  } else if (snapshot.phase === "paused") {
    status = t("localLlm.paused");
  } else if (snapshot.phase === "error") {
    status = t(`localLlm.error.${snapshot.errorCode ?? "network"}`);
  } else if (snapshot.phase === "absent") {
    status = t("localLlm.absent");
  }

  if (compact) {
    const body = (
      <View style={styles.compact}>
        <Text style={styles.compactText}>{snapshot.phase === "scanning" ? t("localLlm.scanning") : status}</Text>
      </View>
    );
    if (!onOpenSettings) {
      return body;
    }
    return (
      <Pressable onPress={onOpenSettings} accessibilityRole="button" accessibilityLabel={status}>
        {body}
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("localLlm.title")}</Text>
      <Text style={styles.recommend}>{t("localLlm.recommend")}</Text>
      <Text style={styles.status}>{status}</Text>
      <Text style={styles.privacy}>{t("localLlm.privacy")}</Text>
      {snapshot.phase === "downloading" && percent == null ? <ActivityIndicator color={theme.accent} /> : null}
      {snapshot.phase === "downloading" && percent != null ? (
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
      ) : null}
      {snapshot.phase === "ready" && snapshot.scope === "sandbox" ? <Text style={styles.note}>{t("localLlm.sandboxNote")}</Text> : null}
      <Text style={styles.note}>{t("localLlm.runtimeGap")}</Text>
      {snapshot.phase === "absent" || snapshot.phase === "error" ? (
        <Pressable onPress={() => void controller.startDownload()} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonText}>{t("localLlm.download")}</Text>
        </Pressable>
      ) : null}
      {snapshot.phase === "downloading" ? (
        <Pressable onPress={() => void controller.pause()} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>{t("localLlm.pause")}</Text>
        </Pressable>
      ) : null}
      {snapshot.phase === "paused" ? (
        <Pressable onPress={() => void controller.resume()} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonText}>{t("localLlm.resume")}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.note}>{t("localLlm.wifi", { size: 100 })}</Text>
      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <Text style={styles.toggleLabel}>{t("localLlm.externalTitle")}</Text>
          <Text style={styles.note}>{t("localLlm.externalBody")}</Text>
        </View>
        <Switch
          value={snapshot.externalAllowed}
          onValueChange={(value) => {
            void controller.setExternalAllowed(value);
          }}
          trackColor={{ false: theme.line, true: theme.accent }}
          accessibilityLabel={t("localLlm.externalTitle")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 14,
    gap: 8,
  },
  title: { color: theme.ink, fontSize: 16, fontWeight: "700" },
  recommend: { color: theme.ink, fontSize: 14, lineHeight: 20 },
  status: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  note: { color: theme.muted, fontSize: 12, lineHeight: 18 },
  privacy: { color: theme.ink, fontSize: 13, lineHeight: 18 },
  track: { height: 8, borderRadius: 999, backgroundColor: theme.line, overflow: "hidden" },
  fill: { height: 8, backgroundColor: theme.accent },
  button: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: theme.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: theme.white, fontWeight: "700", fontSize: 16 },
  secondary: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: theme.ink, fontWeight: "700" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  toggleCopy: { flex: 1, gap: 4 },
  toggleLabel: { color: theme.ink, fontSize: 14, fontWeight: "700" },
  compact: {
    borderRadius: 12,
    backgroundColor: theme.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  compactText: { color: theme.ink, fontSize: 13, lineHeight: 18 },
});
