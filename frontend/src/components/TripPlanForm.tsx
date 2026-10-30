import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { MuseChips } from "./MuseChips";
import { useToast } from "./Toast";
import { ITINERARY_PROMPTS } from "../musePrompts";
import { theme } from "../theme";
import { transportKey } from "../units";

export const TRANSPORTS = ["自驾", "高铁", "飞机", "大巴", "游轮"] as const;
export type Transport = (typeof TRANSPORTS)[number];

export type TripPlanValues = {
  departDate: string;
  days: number;
  companions: number;
  transport: Transport;
  itinerary: string;
};

type Props = {
  title: string;
  initial: TripPlanValues;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (values: TripPlanValues) => void;
};

export function todayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function asTransport(value: string | null | undefined): Transport {
  return TRANSPORTS.find((item) => item === value) ?? "自驾";
}

function monthLabel(year: number, month: number, language: string): string {
  const locale = language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  return new Date(year, month, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

function buildCells(year: number, month: number): Array<number | null> {
  const first = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = Array.from({ length: first }, () => null);
  for (let day = 1; day <= count; day += 1) {
    cells.push(day);
  }
  return cells;
}

export function TripPlanForm({ title, initial, submitting, submitLabel, onSubmit }: Props) {
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();
  const [departDate, setDepartDate] = useState(initial.departDate);
  const [days, setDays] = useState(initial.days);
  const [companions, setCompanions] = useState(initial.companions);
  const [transport, setTransport] = useState<Transport>(initial.transport);
  const [itinerary, setItinerary] = useState(initial.itinerary);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [transportOpen, setTransportOpen] = useState(false);
  const parsed = isValidDate(departDate) ? departDate.split("-").map(Number) : null;
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: parsed?.[0] ?? now.getFullYear(), month: (parsed?.[1] ?? now.getMonth() + 1) - 1 };
  });

  useEffect(() => {
    setDepartDate(initial.departDate);
    setDays(initial.days);
    setCompanions(initial.companions);
    setTransport(initial.transport);
    setItinerary(initial.itinerary);
  }, [initial.companions, initial.days, initial.departDate, initial.itinerary, initial.transport]);

  const cells = useMemo(() => buildCells(cursor.year, cursor.month), [cursor.month, cursor.year]);

  function chooseDay(day: number) {
    const month = String(cursor.month + 1).padStart(2, "0");
    const date = String(day).padStart(2, "0");
    setDepartDate(`${cursor.year}-${month}-${date}`);
    setCalendarOpen(false);
  }

  function submit() {
    if (submitting) {
      return;
    }
    if (!isValidDate(departDate)) {
      showToast(t("tripForm.badDate"));
      return;
    }
    onSubmit({ departDate, days, companions, transport, itinerary: itinerary.trim() });
  }

  return (
    <View style={styles.form}>
      <Text style={styles.sheetTitle}>{title}</Text>
      <Text style={styles.fieldLabel}>{t("tripForm.date")}</Text>
      <Pressable onPress={() => setCalendarOpen((open) => !open)} style={styles.field} accessibilityRole="button">
        <Text style={styles.fieldValue}>{departDate}</Text>
      </Pressable>
      {calendarOpen ? (
        <View style={styles.calendar}>
          <View style={styles.calendarHead}>
            <Pressable
              onPress={() =>
                setCursor((value) =>
                  value.month === 0 ? { year: value.year - 1, month: 11 } : { year: value.year, month: value.month - 1 },
                )
              }
              accessibilityRole="button"
            >
              <Text style={styles.nav}>{t("tripForm.prevMonth")}</Text>
            </Pressable>
            <Text style={styles.month}>{monthLabel(cursor.year, cursor.month, i18n.language)}</Text>
            <Pressable
              onPress={() =>
                setCursor((value) =>
                  value.month === 11 ? { year: value.year + 1, month: 0 } : { year: value.year, month: value.month + 1 },
                )
              }
              accessibilityRole="button"
            >
              <Text style={styles.nav}>{t("tripForm.nextMonth")}</Text>
            </Pressable>
          </View>
          <View style={styles.week}>
            {(t("tripForm.weekdays", { returnObjects: true }) as string[]).map((label) => (
              <Text key={label} style={styles.weekDay}>
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((day, index) =>
              day == null ? (
                <View key={`empty-${index}`} style={styles.cell} />
              ) : (
                <Pressable key={day} onPress={() => chooseDay(day)} style={styles.cell} accessibilityRole="button">
                  <Text style={styles.cellText}>{day}</Text>
                </Pressable>
              ),
            )}
          </View>
        </View>
      ) : null}

      <Text style={styles.fieldLabel}>{t("tripForm.days")}</Text>
      <View style={styles.stepper}>
        <Pressable onPress={() => setDays((value) => Math.max(1, value - 1))} style={styles.step} accessibilityRole="button">
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{t("tripForm.dayCount", { count: days })}</Text>
        <Pressable onPress={() => setDays((value) => Math.min(60, value + 1))} style={styles.step} accessibilityRole="button">
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>

      <Text style={styles.fieldLabel}>{t("tripForm.people")}</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => setCompanions((value) => Math.max(1, value - 1))}
          style={styles.step}
          accessibilityRole="button"
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{t("tripForm.peopleCount", { count: companions })}</Text>
        <Pressable
          onPress={() => setCompanions((value) => Math.min(30, value + 1))}
          style={styles.step}
          accessibilityRole="button"
        >
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>

      <Text style={styles.fieldLabel}>{t("tripForm.transport")}</Text>
      <Pressable onPress={() => setTransportOpen((open) => !open)} style={styles.field} accessibilityRole="button">
        <Text style={styles.fieldValue}>{t(transportKey(transport))}</Text>
      </Pressable>
      {transportOpen ? (
        <View style={styles.menu}>
          {TRANSPORTS.map((item) => (
            <Pressable
              key={item}
              onPress={() => {
                setTransport(item);
                setTransportOpen(false);
              }}
              style={styles.menuItem}
              accessibilityRole="button"
            >
              <Text style={[styles.menuText, item === transport && styles.menuTextOn]}>{t(transportKey(item))}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={styles.note}>{t("tripForm.note")}</Text>

      <Text style={styles.fieldLabel}>{t("tripForm.itinerary")}</Text>
      <MuseChips
        items={ITINERARY_PROMPTS.map((item) => ({ id: item.id, label: t(item.promptKey) }))}
        onPress={(id) => {
          const prompt = ITINERARY_PROMPTS.find((item) => item.id === id);
          if (!prompt) {
            return;
          }
          setItinerary(t(prompt.promptKey).slice(0, 500));
        }}
      />
      <TextInput
        value={itinerary}
        onChangeText={(value) => setItinerary(value.slice(0, 500))}
        multiline
        style={styles.area}
        placeholder={t("tripForm.itineraryPlaceholder")}
        placeholderTextColor="#a39890"
      />
      <Text style={styles.count}>{itinerary.length}/500</Text>

      <Pressable
        onPress={submit}
        disabled={submitting}
        style={[styles.button, submitting && styles.buttonBusy]}
        accessibilityRole="button"
      >
        {submitting ? <ActivityIndicator color={theme.white} /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
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
    justifyContent: "center",
    backgroundColor: theme.bg,
  },
  fieldValue: {
    color: theme.ink,
    fontSize: 16,
  },
  note: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  area: {
    minHeight: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.ink,
    fontSize: 16,
    backgroundColor: theme.bg,
    textAlignVertical: "top",
  },
  count: {
    color: theme.muted,
    fontSize: 12,
    textAlign: "right",
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
    minWidth: 88,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: theme.ink,
  },
  calendar: {
    backgroundColor: theme.bg,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  calendarHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  month: {
    color: theme.ink,
    fontWeight: "700",
  },
  nav: {
    color: theme.accent,
    fontWeight: "600",
  },
  week: {
    flexDirection: "row",
  },
  weekDay: {
    width: "14.28%",
    textAlign: "center",
    color: theme.muted,
    fontSize: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: "14.28%",
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  cellText: {
    color: theme.ink,
    fontSize: 15,
  },
  menu: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    overflow: "hidden",
  },
  menuItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.bg,
  },
  menuText: {
    color: theme.ink,
    fontSize: 16,
  },
  menuTextOn: {
    color: theme.accent,
    fontWeight: "700",
  },
  button: {
    height: 54,
    borderRadius: 16,
    backgroundColor: theme.ink,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    color: theme.white,
    fontSize: 16,
    fontWeight: "700",
  },
});
