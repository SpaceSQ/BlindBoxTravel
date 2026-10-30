import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTranslation } from "react-i18next";

import { ApiError, DISTANCE_OPTIONS_MI, type DistanceMi, type Origin } from "../api";
import { LanguageSetting } from "../components/LanguageSetting";
import { LocalModelCard } from "../components/LocalModelCard";
import { MuseChips } from "../components/MuseChips";
import { errorMessage, useToast } from "../components/Toast";
import { DEFAULT_ORIGIN } from "../config";
import { localLLMProvider } from "../localLlm/provider";
import { MUSE_PROMPTS, rememberMuseContext } from "../musePrompts";
import { ensureLocationNotice } from "../locationConsent";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import type { ExploreStackParamList, RootTabParamList } from "../navigation/types";
import { theme } from "../theme";

type Props = NativeStackScreenProps<ExploreStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [distance, setDistance] = useState<DistanceMi>(250);
  const [origin, setOrigin] = useState<Origin>(DEFAULT_ORIGIN);
  const [usingDefault, setUsingDefault] = useState(true);
  const [locating, setLocating] = useState(true);
  const [loading, setLoading] = useState(false);
  const [armedId, setArmedId] = useState<string | null>(null);
  const told = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let settled = false;

    function useFallback(message: string) {
      if (cancelled || settled) {
        return;
      }
      settled = true;
      setOrigin(DEFAULT_ORIGIN);
      setUsingDefault(true);
      setLocating(false);
      if (!told.current) {
        told.current = true;
        showToast(message);
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    async function locate() {
      const allowed = await ensureLocationNotice();
      if (cancelled) {
        return;
      }
      if (!allowed) {
        settled = true;
        setOrigin(DEFAULT_ORIGIN);
        setUsingDefault(true);
        setLocating(false);
        return;
      }
      timer = setTimeout(() => useFallback(t("home.timeout")), 8000);
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) {
          return;
        }
        if (permission.status !== "granted") {
          if (timer) {
            clearTimeout(timer);
          }
          useFallback(t("home.denied"));
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) {
          return;
        }
        if (timer) {
          clearTimeout(timer);
        }
        settled = true;
        setOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setUsingDefault(false);
        setLocating(false);
      } catch (error) {
        if (timer) {
          clearTimeout(timer);
        }
        const denied = error instanceof Error && /denied|permission/i.test(error.message);
        useFallback(denied ? t("home.denied") : t("home.failed"));
      }
    }

    void locate();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [showToast, t]);

  async function explore(nextQuery = query, nextDistance = distance) {
    const text = nextQuery.trim();
    if (!text) {
      showToast(t("home.emptyQuery"));
      return;
    }
    if (loading) {
      return;
    }
    setLoading(true);
    try {
      const result = await localLLMProvider.complete({
        query: text,
        origin,
        maxDistanceMi: nextDistance,
      });
      navigation.navigate("List", {
        spots: result.response.spots,
        origin,
        query: text,
        maxDistanceMi: result.response.max_distance_mi,
      });
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  const locationLabel = locating ? t("home.locating") : usingDefault ? t("home.fallback") : t("home.located");

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <Text style={styles.kicker}>{t("home.kicker")}</Text>
          <LanguageSetting compact />
        </View>
        <Text style={styles.title}>{t("home.title")}</Text>
        <Text style={styles.lead}>{t("home.lead")}</Text>

        <Text style={styles.label}>{t("home.museTitle")}</Text>
        <Text style={styles.museLead}>{t("home.museLead")}</Text>
        <MuseChips
          items={MUSE_PROMPTS.map((item) => ({ id: item.id, label: t(item.promptKey) }))}
          selectedId={armedId}
          onPress={(id) => {
            const prompt = MUSE_PROMPTS.find((item) => item.id === id);
            if (!prompt) {
              return;
            }
            const phrase = t(prompt.promptKey);
            if (prompt.distance) {
              setDistance(prompt.distance);
            }
            rememberMuseContext(prompt);
            if (armedId === id) {
              void explore(query.trim() ? query : phrase, prompt.distance ?? distance);
              return;
            }
            setArmedId(id);
            setQuery(phrase);
          }}
        />
        <Text style={styles.hint}>{t("home.chipHint")}</Text>
        <Text style={styles.hint}>{t("home.chipSwipe")}</Text>
        <Text style={styles.hint}>{t("home.mileNote")}</Text>
        <Text style={styles.label}>{t("home.promptLabel")}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("home.placeholder")}
          placeholderTextColor="#a39890"
          multiline
          textAlignVertical="top"
          style={styles.input}
        />

        <Text style={styles.label}>{t("home.distanceLabel")}</Text>
        <View style={styles.chips}>
          {DISTANCE_OPTIONS_MI.map((miles) => {
            const selected = miles === distance;
            return (
              <Pressable
                key={miles}
                onPress={() => setDistance(miles)}
                style={[styles.chip, selected && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextOn]}>{t("common.miles", { count: miles })}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.location}>{locationLabel}</Text>

        <Pressable
          onPress={() => {
            void explore();
          }}
          disabled={loading}
          style={[styles.button, loading && styles.buttonDisabled]}
          accessibilityRole="button"
        >
          {loading ? <ActivityIndicator color={theme.white} /> : <Text style={styles.buttonText}>{t("home.explore")}</Text>}
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate("Radar", { query: query.trim() })}
          style={styles.radar}
          accessibilityRole="button"
        >
          <Text style={styles.radarText}>{t("home.radar")}</Text>
        </Pressable>
        <LocalModelCard
          compact
          onOpenSettings={() => navigation.getParent<BottomTabNavigationProp<RootTabParamList>>()?.navigate("Account")}
        />
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
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
  },
  topRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  kicker: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    flexShrink: 1,
  },
  hint: {
    marginTop: 8,
    color: theme.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  title: {
    marginTop: 10,
    color: theme.ink,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: "700",
  },
  lead: {
    marginTop: 12,
    color: theme.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  museLead: {
    marginTop: -4,
    marginBottom: 10,
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    marginTop: 28,
    marginBottom: 10,
    color: theme.ink,
    fontSize: 15,
    fontWeight: "600",
  },
  input: {
    minHeight: 120,
    borderRadius: 18,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: theme.ink,
    fontSize: 16,
    lineHeight: 24,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipOn: {
    backgroundColor: theme.ink,
    borderColor: theme.ink,
  },
  chipText: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: "600",
  },
  chipTextOn: {
    color: theme.white,
  },
  location: {
    marginTop: 14,
    color: theme.muted,
    fontSize: 13,
  },
  button: {
    marginTop: 28,
    height: 54,
    borderRadius: 16,
    backgroundColor: theme.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: theme.white,
    fontSize: 17,
    fontWeight: "700",
  },
  radar: {
    marginTop: 12,
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  radarText: {
    color: theme.accent,
    fontSize: 17,
    fontWeight: "800",
  },
});
