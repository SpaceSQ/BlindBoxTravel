import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ApiError,
  createReview,
  fetchHeat,
  fetchReviews,
  fetchSpot,
  isUnlockedSpot,
  sharePlan,
  unlockSpot,
  type HeatDate,
  type PublicSpot,
  type Review,
  type UnlockedSpot,
} from "../api";
import { useAuth } from "../auth";
import { SpotImage } from "../components/SpotImage";
import { StoryPoster } from "../components/StoryPoster";
import { WeatherCard } from "../components/WeatherCard";
import { TagRow } from "../components/TagRow";
import { PaywallModal } from "../components/PaywallModal";
import { TimeCapsuleSection } from "../components/TimeCapsuleSection";
import { todayString, TripPlanForm, type TripPlanValues } from "../components/TripPlanForm";
import { TripShareSheet } from "../components/TripShareSheet";
import { errorMessage, useToast } from "../components/Toast";
import i18n from "../i18n";
import type { ExploreStackParamList } from "../navigation/types";
import { tagLabel } from "../tagLabel";
import { openDirections } from "../maps";
import { peekMuseContext } from "../musePrompts";
import { shareInvite, shareStoryImage } from "../sharing";
import { theme } from "../theme";
import { formatMiles, transportKey } from "../units";

type Props = NativeStackScreenProps<ExploreStackParamList, "Detail">;

const nativeDriver = Platform.OS !== "web";

type Piece = {
  id: number;
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  color: string;
  dx: number;
  dy: number;
};

function createPieces(): Piece[] {
  return Array.from({ length: 16 }, (_, id) => {
    const angle = (Math.PI * 2 * id) / 16 + 0.15;
    const distance = 88 + (id % 4) * 26;
    return {
      id,
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(0),
      color: ["#e85d04", "#f4a261", "#2a9d8f", "#e9c46a", "#1f1a17"][id % 5],
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - 36,
    };
  });
}

export function DetailScreen({ route }: Props) {
  const { t, i18n } = useTranslation();
  const { spotId, origin, unlockToken: presetToken } = route.params;
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { user } = useAuth();
  const [spot, setSpot] = useState<PublicSpot | null>(null);
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [heat, setHeat] = useState<HeatDate[]>([]);
  const [paywall, setPaywall] = useState(false);
  const [sharingStory, setSharingStory] = useState(false);
  const [planId, setPlanId] = useState<number | null>(null);
  const [planSummary, setPlanSummary] = useState<TripPlanValues | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareToken, setShareToken] = useState("");
  const posterRef = useRef<View>(null);
  const museContext = peekMuseContext();

  const scale = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const flip = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const pieces = useRef(createPieces()).current;
  const rotateY = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "90deg"],
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const next = await fetchSpot(spotId, { origin, unlockToken: presetToken });
        if (!cancelled) {
          setSpot(next);
          setUnlockToken(presetToken && isUnlockedSpot(next) ? presetToken : null);
        }
      } catch (error) {
        if (!cancelled) {
          showToast(errorMessage(error));
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
  }, [origin, presetToken, showToast, spotId]);

  const revealed = unlockToken != null && spot != null && isUnlockedSpot(spot);

  useEffect(() => {
    if (!revealed) {
      return;
    }
    let cancelled = false;
    void fetchReviews(spotId)
      .then((next) => {
        if (!cancelled) {
          setReviews(next);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          showToast(errorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [revealed, showToast, spotId]);

  useEffect(() => {
    let cancelled = false;
    void fetchHeat(spotId)
      .then((dates) => {
        if (!cancelled) {
          setHeat(dates);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHeat([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [spotId]);

  function playReveal(next: UnlockedSpot, token: string) {
    const weather = spot?.weather;
    pieces.forEach((piece) => {
      piece.x.setValue(0);
      piece.y.setValue(0);
      piece.opacity.setValue(0);
    });
    scale.setValue(1);
    shake.setValue(0);
    flip.setValue(0);
    flash.setValue(0);
    const burst = pieces.map((piece) =>
      Animated.sequence([
        Animated.timing(piece.opacity, { toValue: 1, duration: 80, useNativeDriver: nativeDriver }),
        Animated.parallel([
          Animated.timing(piece.x, { toValue: piece.dx, duration: 680, useNativeDriver: nativeDriver }),
          Animated.timing(piece.y, { toValue: piece.dy, duration: 680, useNativeDriver: nativeDriver }),
          Animated.timing(piece.opacity, { toValue: 0, duration: 680, delay: 80, useNativeDriver: nativeDriver }),
        ]),
      ]),
    );
    Animated.parallel([
      Animated.sequence([
        Animated.timing(shake, { toValue: 10, duration: 45, useNativeDriver: nativeDriver }),
        Animated.timing(shake, { toValue: -10, duration: 45, useNativeDriver: nativeDriver }),
        Animated.timing(shake, { toValue: 6, duration: 40, useNativeDriver: nativeDriver }),
        Animated.timing(shake, { toValue: 0, duration: 40, useNativeDriver: nativeDriver }),
      ]),
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 180, useNativeDriver: nativeDriver }),
        Animated.timing(scale, { toValue: 1, duration: 180, useNativeDriver: nativeDriver }),
      ]),
      Animated.sequence([
        Animated.timing(flash, { toValue: 0.85, duration: 120, useNativeDriver: nativeDriver }),
        Animated.timing(flash, { toValue: 0, duration: 420, useNativeDriver: nativeDriver }),
      ]),
      ...burst,
    ]).start(() => {
      Animated.timing(flip, { toValue: 1, duration: 260, useNativeDriver: nativeDriver }).start(() => {
        setUnlockToken(token);
        setSpot({ ...next, weather });
        flip.setValue(1);
        Animated.timing(flip, { toValue: 0, duration: 320, useNativeDriver: nativeDriver }).start();
      });
    });
  }

  async function submitPlan(values: TripPlanValues) {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      if (!user) {
        showToast(t("common.signInFirst"));
        return;
      }
      const result = await unlockSpot(spotId, {
        depart_date: values.departDate,
        days: values.days,
        companions: values.companions,
        transport: values.transport,
        itinerary: values.itinerary,
      });
      setFormOpen(false);
      setPlanId(result.plan_id);
      setPlanSummary(values);
      playReveal(result.spot, result.unlock_token);
    } catch (error) {
      if (error instanceof ApiError && error.status === 402) {
        setPaywall(true);
        return;
      }
      showToast(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReview() {
    const content = reviewText.trim();
    if (!content) {
      showToast(t("detail.reviewEmptyText"));
      return;
    }
    if (reviewing) {
      return;
    }
    setReviewing(true);
    try {
      await createReview(spotId, { rating, content });
      setReviewText("");
      setReviews(await fetchReviews(spotId));
      showToast(t("detail.reviewSaved"));
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setReviewing(false);
    }
  }

  async function sendInvite() {
    if (!spot) {
      return;
    }
    try {
      await shareInvite({ spotId: spot.spot_id, distance: spot.distance_mi });
    } catch (error) {
      showToast(errorMessage(error));
    }
  }

  async function openTripShare() {
    if (!planId) {
      return;
    }
    try {
      const result = await sharePlan(planId);
      setShareToken(result.share_token);
      setShareOpen(true);
    } catch (error) {
      showToast(errorMessage(error));
    }
  }

  async function sendStory() {
    if (sharingStory) {
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.ink} />
      </View>
    );
  }

  if (!spot) {
    return (
      <View style={styles.center}>
        <Text style={styles.missing}>{t("detail.missing")}</Text>
      </View>
    );
  }

  const distance =
    spot.distance_mi == null ? null : t("detail.away", { distance: formatMiles(spot.distance_mi, t("common.mileUnit")) });

  return (
    <View style={styles.screen}>
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <Animated.View
            style={[
              styles.hero,
              {
                transform: [{ translateX: shake }, { scale }, { rotateY }],
              },
            ]}
          >
            <View>
              <SpotImage spotId={spot.spot_id} imageUrl={spot.image_url} aspect="photo" style={styles.image} />
              {revealed ? null : (
                <Pressable
                  onPress={() => void sendStory()}
                  disabled={sharingStory}
                  style={styles.storyButton}
                  accessibilityRole="button"
                  accessibilityLabel={t("share.story")}
                >
                  {sharingStory ? (
                    <ActivityIndicator color={theme.white} />
                  ) : (
                    <Ionicons name="logo-instagram" size={22} color={theme.white} />
                  )}
                </Pressable>
              )}
            </View>
            <Text style={styles.name}>{revealed ? spot.full_name : spot.display_name}</Text>
            <Text style={styles.region}>
              {spot.province} · {spot.city}
              {distance ? ` · ${distance}` : ""}
            </Text>
            {revealed ? (
              <Text style={styles.price}>
                {spot.adult_ticket_price === 0 ? t("detail.freeTicket") : t("detail.ticket", { price: spot.adult_ticket_price })}
              </Text>
            ) : null}
          </Animated.View>
          {spot.weather ? <WeatherCard weather={spot.weather} /> : null}
          <View style={styles.heat}>
            <Text style={styles.sectionTitle}>{t("detail.heatTitle")}</Text>
            {heat.length === 0 ? (
              <VibeMeter people={0} />
            ) : (
              heat.map((item) => <VibeMeter key={item.date} people={item.people} date={formatHeatDate(item.date)} />)
            )}
          </View>
          <Text style={styles.description}>{spot.description}</Text>
          <TagRow tags={spot.tags} />
          {revealed ? (
            <View style={styles.reviews}>
              <Text style={styles.sectionTitle}>{t("detail.reviewsTitle")}</Text>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => setRating(value)}
                    accessibilityRole="button"
                    accessibilityLabel={t("detail.star", { count: value })}
                  >
                    <Text style={value <= rating ? styles.starOn : styles.starOff}>★</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={reviewText}
                onChangeText={setReviewText}
                multiline
                style={styles.reviewInput}
                placeholder={t("detail.reviewPlaceholder")}
                placeholderTextColor="#a39890"
              />
              <Pressable
                onPress={() => {
                  void submitReview();
                }}
                disabled={reviewing}
                style={[styles.reviewButton, reviewing && styles.buttonBusy]}
                accessibilityRole="button"
              >
                {reviewing ? (
                  <ActivityIndicator color={theme.white} />
                ) : (
                  <Text style={styles.buttonText}>{t("detail.submitReview")}</Text>
                )}
              </Pressable>
              {reviews == null ? (
                <ActivityIndicator color={theme.ink} />
              ) : reviews.length === 0 ? (
                <Text style={styles.reviewEmpty}>{t("detail.noReviews")}</Text>
              ) : (
                reviews.map((item) => (
                  <View key={item.id} style={styles.reviewCard}>
                    <Text style={styles.reviewStars}>{"★".repeat(item.rating)}</Text>
                    <Text style={styles.reviewContent}>{item.content}</Text>
                    <Text style={styles.reviewTime}>{item.created_at}</Text>
                  </View>
                ))
              )}
            </View>
          ) : null}
          {revealed && isUnlockedSpot(spot) ? <TimeCapsuleSection spot={spot} /> : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {revealed && isUnlockedSpot(spot) ? (
            <Pressable
              onPress={() => void openDirections(spot.location.lat, spot.location.lng)}
              style={styles.directions}
              accessibilityRole="button"
            >
              <Ionicons name="navigate" size={18} color={theme.ink} />
              <Text style={styles.directionsText}>{t("detail.directions")}</Text>
            </Pressable>
          ) : null}
          {revealed && planId ? (
            <Pressable onPress={() => void openTripShare()} style={styles.directions} accessibilityRole="button">
              <Ionicons name="share-outline" size={18} color={theme.ink} />
              <Text style={styles.directionsText}>{t("trips.share")}</Text>
            </Pressable>
          ) : null}
          {revealed ? null : (
            <Pressable onPress={() => void sendInvite()} style={styles.coUnlock} accessibilityRole="button">
              <Ionicons name="paper-plane-outline" size={18} color={theme.ink} />
              <Text style={styles.coUnlockText}>{t("detail.coUnlock")}</Text>
            </Pressable>
          )}
          <Pressable
            disabled={revealed}
            onPress={() => setFormOpen(true)}
            style={[styles.button, revealed && styles.buttonDone]}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonText, revealed && styles.buttonTextDone]}>
              {revealed ? t("detail.added") : t("detail.add")}
            </Text>
          </Pressable>
        </View>
      </View>

      <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} />
      <View pointerEvents="none" style={styles.confettiLayer}>
        {pieces.map((piece) => (
          <Animated.View
            key={piece.id}
            style={[
              styles.piece,
              {
                backgroundColor: piece.color,
                opacity: piece.opacity,
                transform: [{ translateX: piece.x }, { translateY: piece.y }],
              },
            ]}
          />
        ))}
      </View>

      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setFormOpen(false)} />
          <ScrollView style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20), maxHeight: "85%" }]}>
            <TripPlanForm
              title={t("detail.formTitle")}
              initial={{
                departDate: todayString(),
                days: museContext.days ?? 1,
                companions: museContext.companions ?? 1,
                transport: "自驾",
                itinerary: "",
              }}
              submitting={submitting}
              submitLabel={t("detail.unlock")}
              onSubmit={(values) => {
                void submitPlan(values);
              }}
            />
          </ScrollView>
        </View>
      </Modal>
      <PaywallModal visible={paywall} onClose={() => setPaywall(false)} />
      <TripShareSheet
        visible={shareOpen}
        place={isUnlockedSpot(spot) ? `${spot.city}, ${spot.province}` : spot.display_name}
        lines={
          planSummary
            ? [
                isUnlockedSpot(spot) ? spot.full_name : spot.display_name,
                t("trips.summary", {
                  date: planSummary.departDate,
                  daysLabel: t("tripForm.dayCount", { count: planSummary.days }),
                  peopleLabel: t("tripForm.peopleCount", { count: planSummary.companions }),
                  transport: t(transportKey(planSummary.transport)),
                }),
              ]
            : [isUnlockedSpot(spot) ? spot.full_name : spot.display_name]
        }
        token={shareToken}
        onClose={() => setShareOpen(false)}
      />
      <View pointerEvents="none" style={styles.offscreen}>
        <StoryPoster
          ref={posterRef}
          spotId={spot.spot_id}
          imageUrl={spot.image_url}
          name={spot.display_name}
          tags={spot.tags.filter((tag) => tag.strength === "strong").map((tag) => tagLabel(tag, i18n.language))}
        />
      </View>
    </View>
  );
}

function formatHeatDate(value: string): string {
  const locale = i18n.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  return new Date(`${value}T00:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function vibeLevel(people: number): { label: "detail.vibeChill" | "detail.vibeBuzzing" | "detail.vibePacked"; icon: "leaf" | "flame" | "balloon"; color: string } {
  if (people <= 2) {
    return { label: "detail.vibeChill", icon: "leaf", color: "#2f6b4f" };
  }
  if (people <= 10) {
    return { label: "detail.vibeBuzzing", icon: "flame", color: "#e85d04" };
  }
  return { label: "detail.vibePacked", icon: "balloon", color: "#7b3ff2" };
}

function VibeMeter({ people, date }: { people: number; date?: string }) {
  const { t } = useTranslation();
  const vibe = vibeLevel(people);
  return (
    <View style={styles.vibeRow}>
      <Ionicons name={vibe.icon} size={18} color={vibe.color} />
      <Text style={[styles.vibeLabel, { color: vibe.color }]}>{t(vibe.label)}</Text>
      {date ? <Text style={styles.vibeDate}>{date}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.bg,
  },
  missing: {
    color: theme.muted,
    fontSize: 16,
  },
  content: {
    padding: 20,
    paddingBottom: 24,
    gap: 12,
  },
  hero: {
    gap: 12,
    backfaceVisibility: "hidden",
  },
  image: {
    width: "100%",
    borderRadius: 20,
    backgroundColor: theme.chip,
  },
  heat: {
    gap: 6,
  },
  vibeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  vibeLabel: { fontSize: 16, fontWeight: "700" },
  vibeDate: { color: theme.muted, fontSize: 14 },
  name: {
    color: theme.ink,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "700",
    letterSpacing: 1,
  },
  region: {
    color: theme.muted,
    fontSize: 14,
  },
  price: {
    color: theme.accent,
    fontSize: 18,
    fontWeight: "700",
  },
  description: {
    color: theme.ink,
    fontSize: 16,
    lineHeight: 26,
  },
  reviews: {
    marginTop: 8,
    gap: 10,
  },
  sectionTitle: {
    color: theme.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  stars: {
    flexDirection: "row",
    gap: 6,
  },
  starOn: {
    color: theme.accent,
    fontSize: 28,
  },
  starOff: {
    color: "#d9cfc6",
    fontSize: 28,
  },
  reviewInput: {
    minHeight: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.ink,
    fontSize: 16,
    backgroundColor: theme.card,
    textAlignVertical: "top",
  },
  reviewButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: theme.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewEmpty: {
    color: theme.muted,
    fontSize: 14,
  },
  reviewCard: {
    backgroundColor: theme.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 12,
    gap: 4,
  },
  reviewStars: {
    color: theme.accent,
    fontSize: 14,
  },
  reviewContent: {
    color: theme.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  reviewTime: {
    color: theme.muted,
    fontSize: 12,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    backgroundColor: theme.bg,
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  directions: {
    height: 48,
    borderRadius: 16,
    backgroundColor: theme.accentSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  directionsText: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  coUnlock: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  coUnlockText: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  storyButton: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(18,15,13,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  offscreen: {
    position: "absolute",
    left: -2400,
    top: 0,
  },
  button: {
    height: 54,
    borderRadius: 16,
    backgroundColor: theme.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDone: {
    backgroundColor: theme.accentSoft,
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    color: theme.white,
    fontSize: 16,
    fontWeight: "700",
  },
  buttonTextDone: {
    color: theme.accent,
  },
  flash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#fffaf3",
  },
  confettiLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  piece: {
    position: "absolute",
    width: 9,
    height: 9,
    borderRadius: 2,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(31, 26, 23, 0.35)",
  },
  sheet: {
    backgroundColor: theme.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 8,
  },
  sheetTitle: {
    color: theme.ink,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  fieldLabel: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
  },
  field: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    color: theme.ink,
    fontSize: 16,
    backgroundColor: theme.bg,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  step: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.bg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.line,
  },
  stepText: {
    fontSize: 22,
    color: theme.ink,
  },
  stepValue: {
    minWidth: 24,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: theme.ink,
  },
  transports: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  transport: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
  },
  transportOn: {
    backgroundColor: theme.ink,
    borderColor: theme.ink,
  },
  transportText: {
    color: theme.ink,
    fontWeight: "600",
  },
  transportTextOn: {
    color: theme.white,
  },
});
