import { useTranslation } from "react-i18next";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, type CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError, fetchWishlists, type RadarSpot } from "../api";
import { useAuth } from "../auth";
import { SpotImage } from "../components/SpotImage";
import { errorMessage, useToast } from "../components/Toast";
import type { ExploreStackParamList, RootTabParamList } from "../navigation/types";
import { tagLabel } from "../tagLabel";
import { theme } from "../theme";

type Props = CompositeScreenProps<
  BottomTabScreenProps<RootTabParamList, "Wishlist">,
  NativeStackScreenProps<ExploreStackParamList>
>;

export function WishlistScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { user, ready } = useAuth();
  const { showToast } = useToast();
  const [spots, setSpots] = useState<RadarSpot[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setSpots([]);
      return;
    }
    setLoading(true);
    try {
      const result = await fetchWishlists();
      setSpots(result.spots);
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [showToast, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function openSpot(spot: RadarSpot) {
    navigation.navigate("Explore", { screen: "Detail", params: { spotId: spot.spot_id } });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>WISHLIST</Text>
        <Text style={styles.title}>{t("wishlist.title")}</Text>
        <Text style={styles.lead}>{t("wishlist.lead")}</Text>
        {!ready || loading ? <ActivityIndicator color={theme.accent} style={styles.spinner} /> : null}
        {ready && !user ? <Text style={styles.empty}>{t("wishlist.signedOut")}</Text> : null}
        {ready && user && !loading && spots.length === 0 ? (
          <Text style={styles.empty}>{t("wishlist.empty")}</Text>
        ) : null}
        {spots.map((spot) => (
          <Pressable key={spot.spot_id} onPress={() => openSpot(spot)} style={styles.card} accessibilityRole="button">
            <SpotImage spotId={spot.spot_id} imageUrl={spot.image_url} aspect="square" style={styles.thumb} />
            <View style={styles.body}>
              <Text style={styles.name}>{spot.display_name}</Text>
              <Text style={styles.tags} numberOfLines={2}>
                {spot.tags
                  .filter((tag) => tag.strength === "strong")
                  .map((tag) => tagLabel(tag, i18n.language))
                  .join(" · ")}
              </Text>
              <Text style={styles.place}>
                {spot.province} · {spot.city}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
  },
  kicker: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  title: {
    marginTop: 8,
    color: theme.ink,
    fontSize: 32,
    fontWeight: "700",
  },
  lead: {
    marginTop: 8,
    marginBottom: 18,
    color: theme.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  spinner: {
    marginVertical: 20,
  },
  empty: {
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    flexDirection: "row",
    backgroundColor: theme.card,
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 12,
  },
  thumb: {
    width: 108,
  },
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "center",
  },
  name: {
    color: theme.ink,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 1,
  },
  tags: {
    marginTop: 6,
    color: theme.accent,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  place: {
    marginTop: 6,
    color: theme.muted,
    fontSize: 13,
  },
});
