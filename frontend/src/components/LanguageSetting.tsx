import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { appLanguage, setAppLanguage, type AppLanguage } from "../i18n";
import { theme } from "../theme";

export function LanguageSetting({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const current = appLanguage(i18n.language);
  function choose(language: AppLanguage) {
    void setAppLanguage(language);
  }
  return (
    <View style={compact ? styles.compact : undefined}>
      {compact ? null : <Text style={styles.label}>{t("account.language")}</Text>}
      <View style={styles.switch}>
        {(["en-US", "zh-CN"] as const).map((language) => {
          const selected = current === language;
          const label = language === "en-US" ? t("account.languageEn") : t("account.languageZh");
          return (
            <Pressable
              key={language}
              onPress={() => choose(language)}
              style={[styles.switchItem, selected && styles.switchOn]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
            >
              <Text style={[styles.switchText, selected && styles.switchTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compact: { alignItems: "flex-end" },
  label: { color: theme.muted, fontSize: 13, fontWeight: "600", marginTop: 8 },
  switch: { flexDirection: "row", gap: 8 },
  switchItem: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
  },
  switchOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  switchText: { color: theme.ink, fontWeight: "700" },
  switchTextOn: { color: theme.white },
});
