import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError, fetchRadar, saveWishlist, type RadarSpot } from "../api";
import { useAuth } from "../auth";
import { isUsableImage } from "../components/SpotImage";
import { StoryPoster } from "../components/StoryPoster";
import { SwipeDeck, type SwipeDeckHandle } from "../components/SwipeDeck";
import { errorMessage, useToast } from "../components/Toast";
import type { ExploreStackParamList, RootTabParamList } from "../navigation/types";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { shareStoryImage } from "../sharing";
import { tagLabel } from "../tagLabel";

type Props = NativeStackScreenProps<ExploreStackParamList, "Radar">;

const COMBO = 10;

function uniqueSpots(spots: RadarSpot[], blocked: Iterable<string>): RadarSpot[] {
  const skip = new Set(blocked);
  const fresh: RadarSpot[] = [];
  for (const spot of spots) {
    if (!spot.spot_id || skip.has(spot.spot_id) || !isUsableImage(spot.image_url)) {
      continue;
    }
    skip.add(spot.spot_id);
    fresh.push(spot);
  }
  return fresh;
}

function pickBest(spots: RadarSpot[]): RadarSpot | null {
  return spots.reduce<RadarSpot | null>((best, spot) => {
    if (!best || spot.match_score >= best.match_score) {
      return spot;
    }
    return best;
  }, null);
}

export function RadarScreen({ navigation, route }: Props) {
  const { t, i18n } = useTranslation();
  const query = route.params?.query?.trim() ?? "";
  const { user } = useAuth();
  const { showToast } = useToast();
  const deckRef = useRef<SwipeDeckHandle>(null);
  const cardsRef = useRef<RadarSpot[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const liked = useRef<RadarSpot[]>([]);
  const swipesRef = useRef(0);
  const pausedRef = useRef(false);
  const filling = useRef(false);
  const [cards, setCards] = useState<RadarSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [swipes, setSwipes] = useState(0);
  const [likes, setLikes] = useState(0);
  const [paused, setPaused] = useState(false);
  const [best, setBest] = useState<RadarSpot | null>(null);
  const [sharingStory, setSharingStory] = useState(false);
  const posterRef = useRef<View>(null);

  const setDeck = useCallback((next: RadarSpot[]) => {
    cardsRef.current = next;
    setCards(next);
  }, []);

  const refill = useCallback(
    async (remaining: RadarSpot[]) => {
      if (pausedRef.current || filling.current || remaining.length >= 4) {
        return;
      }
      filling.current = true;
      try {
        const blocked = [...seen.current, ...cardsRef.current.map((item) => item.spot_id)];
        const result = await fetchRadar({ limit: 15, query, exclude: blocked.join(",") });
        const fresh = uniqueSpots(result.spots, blocked);
        if (fresh.length > 0) {
          setDeck([...cardsRef.current, ...fresh]);
        }
      } catch (error) {
        showToast(error instanceof ApiError ? error.message : errorMessage(error));
      } finally {
        filling.current = false;
      }
    },
    [query, setDeck, showToast],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await fetchRadar({ limit: 15, query });
        if (!cancelled) {
          setDeck(uniqueSpots(result.spots, seen.current));
        }
      } catch (error) {
        if (!cancelled) {
          showToast(error instanceof ApiError ? error.message : errorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [query, setDeck, showToast]);

  function allowSwipe(direction: "left" | "right") {
    if (direction === "right" && !user) {
      showToast(t("common.signInFirst"));
      return false;
    }
    return true;
  }

  function onSwiped(direction: "left" | "right") {
    const spot = cardsRef.current[0];
    if (!spot) {
      return;
    }
    const rest = cardsRef.current.slice(1);
    seen.current.add(spot.spot_id);
    if (direction === "right") {
      void remember(spot);
    }
    setDeck(rest);
    swipesRef.current += 1;
    setSwipes(swipesRef.current);
    if (swipesRef.current >= COMBO) {
      pausedRef.current = true;
      setPaused(true);
      return;
    }
    void refill(rest);
  }

  async function remember(spot: RadarSpot) {
    try {
      await saveWishlist(spot.spot_id);
      if (!liked.current.some((item) => item.spot_id === spot.spot_id)) {
        liked.current = [...liked.current, spot];
        setLikes(liked.current.length);
        setBest(pickBest(liked.current));
      }
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : errorMessage(error));
      seen.current.delete(spot.spot_id);
      const back = [spot, ...cardsRef.current.filter((item) => item.spot_id !== spot.spot_id)];
      setDeck(back);
      swipesRef.current = Math.max(0, swipesRef.current - 1);
      setSwipes(swipesRef.current);
      pausedRef.current = false;
      setPaused(false);
    }
  }

  function continueSwipe() {
    swipesRef.current = 0;
    setSwipes(0);
    pausedRef.current = false;
    setPaused(false);
    if (cardsRef.current.length === 0) {
      void refill([]);
    }
  }

  function openBest() {
    if (!best) {
      showToast(t("radar.likeFirst"));
      return;
    }
    navigation.navigate("Detail", { spotId: best.spot_id });
  }

  function openWishlist() {
    navigation.getParent<BottomTabNavigationProp<RootTabParamList>>()?.navigate("Wishlist");
  }

  const top = cards[0] ?? null;
  const next = cards[1] ?? null;

  async function sendStory() {
    if (!top || sharingStory) {
      return;
    }
    setSharingStory(true);
    try {
      await shareStoryImage(posterRef.current);
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setSharingStory(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.close}>{t("radar.close")}</Text>
        </Pressable>
        <View style={styles.topActions}>
          {top ? (
            <Pressable
              onPress={() => void sendStory()}
              disabled={sharingStory}
              style={styles.storyButton}
              accessibilityRole="button"
              accessibilityLabel={t("share.story")}
            >
              {sharingStory ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="logo-instagram" size={22} color="#fff" />
              )}
            </Pressable>
          ) : null}
          <Text style={styles.combo}>{t("radar.combo", { current: swipes, total: COMBO })}</Text>
        </View>
      </View>

      <View style={styles.stage}>
        {loading ? <ActivityIndicator color="#fff" /> : null}
        {!loading && top ? (
          <SwipeDeck
            ref={deckRef}
            spot={top}
            nextSpot={next}
            enabled={!paused}
            onBeforeSwipe={allowSwipe}
            onSwiped={onSwiped}
          />
        ) : null}
        {!loading && !top && !paused ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("radar.emptyTitle")}</Text>
            <Text style={styles.emptyLead}>{t("radar.emptyLead")}</Text>
            <Pressable onPress={openWishlist} style={styles.emptyButton} accessibilityRole="button">
              <Text style={styles.emptyButtonText}>{t("radar.wishlist")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => deckRef.current?.fly("left")}
          style={[styles.action, styles.skip]}
          accessibilityRole="button"
          accessibilityLabel={t("radar.skip")}
        >
          <Text style={styles.skipText}>{t("radar.skip")}</Text>
        </Pressable>
        <Pressable
          onPress={() => deckRef.current?.fly("right")}
          style={[styles.action, styles.like]}
          accessibilityRole="button"
          accessibilityLabel={t("radar.like")}
        >
          <Text style={styles.likeText}>{t("radar.like")}</Text>
        </Pressable>
      </View>

      {paused ? (
        <View style={styles.prompt}>
          <Text style={styles.promptKicker}>RADAR LOCK</Text>
          <Text style={styles.promptTitle}>{t("radar.promptTitle")}</Text>
          <Text style={styles.promptBody}>
            {t("radar.promptBody", { count: likes })}
          </Text>
          <Pressable onPress={openBest} style={styles.primary} accessibilityRole="button">
            <Text style={styles.primaryText}>{t("radar.unlockNow")}</Text>
          </Pressable>
          <Pressable onPress={continueSwipe} style={styles.secondary} accessibilityRole="button">
            <Text style={styles.secondaryText}>{t("radar.keepSwiping")}</Text>
          </Pressable>
        </View>
      ) : null}
      {top ? (
        <View pointerEvents="none" style={styles.offscreen}>
          <StoryPoster
            ref={posterRef}
            spotId={top.spot_id}
            imageUrl={top.image_url}
            name={top.display_name}
            tags={top.tags.filter((tag) => tag.strength === "strong").map((tag) => tagLabel(tag, i18n.language))}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#120f0d",
  },
  topBar: {
    height: 48,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  close: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  combo: {
    color: "#ffb085",
    fontSize: 15,
    fontWeight: "800",
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  storyButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  offscreen: {
    position: "absolute",
    left: -2400,
    top: 0,
  },
  stage: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyLead: {
    marginTop: 10,
    color: "rgba(255,255,255,0.72)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  emptyButton: {
    marginTop: 22,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  emptyButtonText: {
    color: "#1f1a17",
    fontSize: 16,
    fontWeight: "800",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 28,
    paddingBottom: 12,
    paddingTop: 8,
  },
  action: {
    width: 108,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  skip: {
    backgroundColor: "#2a2420",
  },
  like: {
    backgroundColor: "#e85d04",
  },
  skipText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
  },
  likeText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
  },
  prompt: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(10,8,7,0.94)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  promptKicker: {
    color: "#ffb085",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  promptTitle: {
    marginTop: 14,
    color: "#fff",
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "800",
    textAlign: "center",
  },
  promptBody: {
    marginTop: 16,
    color: "rgba(255,255,255,0.82)",
    fontSize: 16,
    lineHeight: 26,
    textAlign: "center",
  },
  primary: {
    marginTop: 28,
    width: "100%",
    height: 54,
    borderRadius: 16,
    backgroundColor: "#e85d04",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
  },
  secondary: {
    marginTop: 12,
    width: "100%",
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
