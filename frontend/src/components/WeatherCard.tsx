import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import type { SpotWeather, WeatherSlice } from "../api";
import { theme } from "../theme";

function windText(slice: WeatherSlice, scaleLabel: (value: string) => string): string {
  const scale = slice.wind_scale ? scaleLabel(slice.wind_scale.replace(/级$/, "")) : "";
  return [slice.wind_dir, scale].filter(Boolean).join(" ") || "—";
}

function precipAmount(value: string, unit: "mm" | "in" | undefined, language: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  const source = unit === "in" ? "in" : "mm";
  if (language.toLowerCase().startsWith("zh")) {
    const mm = source === "mm" ? amount : amount * 25.4;
    return mm >= 10 ? mm.toFixed(0) : mm.toFixed(1);
  }
  const inches = source === "in" ? amount : amount / 25.4;
  if (inches === 0) {
    return "0";
  }
  return inches < 0.1 ? inches.toFixed(2) : inches.toFixed(2);
}

function precipText(
  slice: WeatherSlice,
  chance: (value: string) => string,
  chanceUnknown: string,
  precip: (value: string) => string,
  precipUnknown: string,
): string {
  const parts = [slice.pop ? chance(slice.pop) : chanceUnknown, slice.precip ? precip(slice.precip) : precipUnknown];
  return parts.join(" · ");
}

function PeriodColumn({
  title,
  slice,
  showPrecip,
  wind,
  rain,
}: {
  title: string;
  slice: WeatherSlice;
  showPrecip: boolean;
  wind: string;
  rain: string;
}) {
  return (
    <View style={styles.column}>
      <Text style={styles.period}>{title}</Text>
      <Text style={styles.periodRange}>{slice.period}</Text>
      <Text style={styles.fact}>{slice.text || "—"}</Text>
      <Text style={styles.meta}>{wind}</Text>
      {showPrecip ? <Text style={styles.meta}>{rain}</Text> : null}
    </View>
  );
}

export function WeatherCard({ weather }: { weather: SpotWeather }) {
  const { t, i18n } = useTranslation();
  const rain = (slice: WeatherSlice) =>
    precipText(
      slice,
      (value) => t("weather.chance", { value }),
      t("weather.chanceUnknown"),
      (value) =>
        t("weather.precip", {
          value: precipAmount(value, weather.status === "ok" ? weather.precip_unit : "mm", i18n.language),
        }),
      t("weather.precipUnknown"),
    );
  if (weather.status !== "ok") {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t("weather.title")}</Text>
        <Text style={styles.message}>{weather.message}</Text>
      </View>
    );
  }

  const allDay = weather.precip_scope === "all_day";
  const airName = weather.air.city_name || weather.city_name || t("weather.city");

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("weather.title")}</Text>
      <Text style={styles.temp}>
        {weather.temp_max != null ? `${weather.temp_max}°F` : "—"}
        <Text style={styles.tempSep}> / </Text>
        {weather.temp_min != null ? `${weather.temp_min}°F` : "—"}
      </Text>
      <Text style={styles.tempHint}>{t("weather.highLow")}</Text>
      {allDay ? <Text style={styles.allDay}>{t("weather.allDay", { detail: rain(weather.day) })}</Text> : null}
      <View style={styles.columns}>
        <PeriodColumn
          title={t("weather.day")}
          slice={weather.day}
          showPrecip={!allDay}
          wind={windText(weather.day, (value) => t("weather.windScale", { value }))}
          rain={rain(weather.day)}
        />
        <PeriodColumn
          title={t("weather.night")}
          slice={weather.night}
          showPrecip={!allDay}
          wind={windText(weather.night, (value) => t("weather.windScale", { value }))}
          rain={rain(weather.night)}
        />
      </View>
      <View style={styles.metrics}>
        <Text style={styles.metric}>{t("weather.uv", { value: weather.uv_index ?? "—" })}</Text>
        <Text style={styles.metric}>
          {airName} AQI {weather.air.aqi ?? "—"}
          {weather.air.category ? ` ${weather.air.category}` : ""}
        </Text>
      </View>
      {weather.attributions.length > 0 ? (
        <Text style={styles.attribution}>{weather.attributions.join(" · ")}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  title: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  message: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  temp: {
    color: theme.ink,
    fontSize: 32,
    fontWeight: "700",
    marginTop: 2,
  },
  tempSep: {
    color: theme.muted,
    fontSize: 22,
    fontWeight: "500",
  },
  tempHint: {
    color: theme.muted,
    fontSize: 12,
  },
  allDay: {
    color: theme.ink,
    fontSize: 13,
    lineHeight: 18,
  },
  columns: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
  },
  column: {
    flex: 1,
    backgroundColor: theme.bg,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  period: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  periodRange: {
    color: theme.muted,
    fontSize: 11,
  },
  fact: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 2,
  },
  meta: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  metrics: {
    gap: 4,
    marginTop: 4,
  },
  metric: {
    color: theme.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  attribution: {
    color: theme.muted,
    fontSize: 11,
    lineHeight: 16,
  },
});
