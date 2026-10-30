import { ScrollView, Pressable, StyleSheet, Text } from "react-native";

import { theme } from "../theme";

export type MuseChipItem = {
  id: string;
  label: string;
};

type Props = {
  items: MuseChipItem[];
  selectedId?: string | null;
  onPress: (id: string) => void;
};

export function MuseChips({ items, selectedId, onPress }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Pressable
            key={item.id}
            onPress={() => onPress(item.id)}
            style={[styles.chip, selected && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={item.label}
          >
            <Text style={[styles.text, selected && styles.textOn]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: {
    backgroundColor: theme.accentSoft,
    borderColor: theme.accent,
  },
  text: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: "600",
  },
  textOn: {
    color: theme.accent,
  },
});
