import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { LockedSpot } from "../api";
import { SpotImage } from "../components/SpotImage";
import { TagRow } from "../components/TagRow";
import type { ExploreStackParamList } from "../navigation/types";
import { theme } from "../theme";
import { formatMiles } from "../units";

type Props = NativeStackScreenProps<ExploreStackParamList, "List">;

export function ListScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { spots, origin, query, maxDistanceMi } = route.params;

  function openDetail(spot: LockedSpot) {
    navigation.navigate("Detail", { spotId: spot.spot_id, origin });
  }

  return (
    <FlatList
      data={spots}
      keyExtractor={(item) => item.spot_id}
      contentContainerStyle={styles.list}
      style={styles.screen}
      ListHeaderComponent={
        <Text style={styles.hint}>
          {t("list.range", { query, miles: maxDistanceMi })}
        </Text>
      }
      ListEmptyComponent={<Text style={styles.empty}>{t("list.empty")}</Text>}
      renderItem={({ item }) => (
        <Pressable onPress={() => openDetail(item)} style={styles.card} accessibilityRole="button">
          <SpotImage spotId={item.spot_id} imageUrl={item.image_url} aspect="wide" style={styles.image} />
          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={styles.name}>{item.display_name}</Text>
              <Text style={styles.distance}>
                {item.distance_mi == null ? t("list.unknown") : formatMiles(item.distance_mi, t("common.mileUnit"))}
              </Text>
            </View>
            <Text style={styles.summary}>{item.summary_100w}</Text>
            <TagRow tags={item.tags} />
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  hint: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  empty: {
    marginTop: 32,
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    backgroundColor: theme.card,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.line,
  },
  image: {
    width: "100%",
    backgroundColor: theme.chip,
  },
  body: {
    padding: 16,
    gap: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  name: {
    flex: 1,
    color: theme.ink,
    fontSize: 22,
    fontWeight: "700",
    flexShrink: 1,
  },
  distance: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  summary: {
    color: theme.muted,
    fontSize: 15,
    lineHeight: 22,
  },
});
