import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import type { SpotTag } from "../api/types";
import { tagLabel } from "../tagLabel";
import { theme } from "../theme";

export function TagRow({ tags }: { tags: SpotTag[] }) {
  const { i18n } = useTranslation();
  return (
    <View style={styles.row}>
      {tags.map((tag) => {
        const strong = tag.strength === "strong";
        return (
          <View key={tag.name} style={[styles.tag, strong ? styles.strong : styles.weak]}>
            <Text style={[styles.text, strong ? styles.strongText : styles.weakText]}>{tagLabel(tag, i18n.language)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  strong: {
    backgroundColor: theme.accent,
  },
  weak: {
    backgroundColor: theme.chip,
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
  strongText: {
    color: theme.white,
  },
  weakText: {
    color: theme.muted,
  },
});
