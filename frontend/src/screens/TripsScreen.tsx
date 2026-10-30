import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { deletePlan, fetchPlans, importShare, sharePlan, updatePlan, type TripPlan } from "../api";
import { useAuth } from "../auth";
import { SpotImage } from "../components/SpotImage";
import { TripShareSheet } from "../components/TripShareSheet";
import { asTransport, TripPlanForm, type TripPlanValues } from "../components/TripPlanForm";
import { errorMessage, useToast } from "../components/Toast";
import { DEFAULT_ORIGIN } from "../config";
import type { RootTabParamList } from "../navigation/types";
import { tokenFromShareText } from "../sharing";
import { theme } from "../theme";
import { transportKey } from "../units";

type Props = BottomTabScreenProps<RootTabParamList, "Trips">;

export function TripsScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { user } = useAuth();
  const [plans, setPlans] = useState<TripPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TripPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TripPlan | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ token: string; plan: TripPlan } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importing, setImporting] = useState(false);
  const consumedLink = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const data = await fetchPlans();
    setPlans(data.plans);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function load() {
        if (!user) {
          if (!cancelled) {
            setPlans([]);
            setLoading(false);
          }
          return;
        }
        setLoading(true);
        try {
          const data = await fetchPlans();
          if (!cancelled) {
            setPlans(data.plans);
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
    }, [showToast, user]),
  );

  function openDetail(plan: TripPlan) {
    navigation.navigate("Explore", {
      screen: "Detail",
      params: {
        spotId: plan.spot_id,
        origin: DEFAULT_ORIGIN,
        unlockToken: plan.unlock_token,
      },
    });
  }

  async function savePlan(values: TripPlanValues) {
    if (!editing || saving) {
      return;
    }
    setSaving(true);
    try {
      await updatePlan(editing.id, {
        depart_date: values.departDate,
        days: values.days,
        companions: values.companions,
        transport: values.transport,
        itinerary: values.itinerary,
      });
      setEditing(null);
      await reload();
      showToast(t("trips.updated"));
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) {
      return;
    }
    setDeleting(true);
    try {
      await deletePlan(pendingDelete.id);
      setPendingDelete(null);
      await reload();
      showToast(t("trips.deleted"));
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  async function openShare(plan: TripPlan) {
    try {
      const result = await sharePlan(plan.id);
      setShareTarget({ token: result.share_token, plan });
    } catch (error) {
      showToast(errorMessage(error));
    }
  }

  async function acceptShare(token: string) {
    const code = tokenFromShareText(token);
    if (!code || importing) {
      return;
    }
    setImporting(true);
    try {
      await importShare(code);
      setImportOpen(false);
      setImportCode("");
      navigation.setParams({ importToken: undefined });
      await reload();
      showToast(t("trips.imported"));
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setImporting(false);
    }
  }

  const importToken = route.params?.importToken;
  useEffect(() => {
    if (!importToken || consumedLink.current === importToken) {
      return;
    }
    if (!user) {
      setImportCode(importToken);
      setImportOpen(true);
      showToast(t("common.signInFirst"));
      return;
    }
    consumedLink.current = importToken;
    void acceptShare(importToken);
  }, [importToken, showToast, t, user]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <Text style={styles.title}>{t("trips.title")}</Text>
      <Text style={styles.subtitle}>{t("trips.lead")}</Text>
      {user ? (
        <Pressable onPress={() => setImportOpen(true)} style={styles.importButton} accessibilityRole="button">
          <Text style={styles.importText}>{t("trips.importButton")}</Text>
        </Pressable>
      ) : null}
      {!user ? (
        <Text style={styles.empty}>{t("trips.signedOut")}</Text>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.ink} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {plans.length === 0 ? <Text style={styles.empty}>{t("trips.empty")}</Text> : null}
          {plans.map((plan) => (
            <View key={plan.id} style={styles.card}>
              <Pressable onPress={() => openDetail(plan)} style={styles.cardBody} accessibilityRole="button">
                <SpotImage spotId={plan.spot_id} imageUrl={plan.image_url} aspect="square" style={styles.thumb} />
                <View style={styles.cardCopy}>
                  <Text style={styles.name}>{plan.full_name}</Text>
                  <Text style={styles.meta}>
                    {plan.province} · {plan.city}
                  </Text>
                  <Text style={styles.meta}>
                    {t("trips.summary", {
                      date: plan.depart_date,
                      daysLabel: t("tripForm.dayCount", { count: plan.days }),
                      peopleLabel: t("tripForm.peopleCount", { count: plan.companions }),
                      transport: t(transportKey(plan.transport)),
                    })}
                  </Text>
                  {plan.itinerary ? <Text style={styles.meta}>{plan.itinerary}</Text> : null}
                </View>
              </Pressable>
              <View style={styles.actions}>
                <Pressable onPress={() => setEditing(plan)} style={styles.action} accessibilityRole="button">
                  <Text style={styles.actionText}>{t("trips.edit")}</Text>
                </Pressable>
                <Pressable onPress={() => void openShare(plan)} style={styles.action} accessibilityRole="button">
                  <Text style={styles.actionText}>{t("trips.share")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setPendingDelete(plan)}
                  style={[styles.action, styles.actionDanger]}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionDangerText}>{t("trips.delete")}</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={editing != null} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setEditing(null)} />
          {editing ? (
            <ScrollView style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <TripPlanForm
                key={editing.id}
                title={t("trips.editTitle")}
                initial={{
                  departDate: editing.depart_date,
                  days: editing.days || 1,
                  companions: editing.companions,
                  transport: asTransport(editing.transport),
                  itinerary: editing.itinerary || "",
                }}
                submitting={saving}
                submitLabel={t("trips.save")}
                onSubmit={(values) => {
                  void savePlan(values);
                }}
              />
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={pendingDelete != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDelete(null)}
      >
        <View style={styles.confirmRoot}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t("trips.deleteTitle")}</Text>
            <Text style={styles.confirmBody}>
              {pendingDelete ? t("trips.deleteBody", { name: pendingDelete.full_name }) : ""}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setPendingDelete(null)}
                style={styles.confirmCancel}
                accessibilityRole="button"
              >
                <Text style={styles.confirmCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void confirmDelete();
                }}
                disabled={deleting}
                style={styles.confirmDelete}
                accessibilityRole="button"
              >
                {deleting ? (
                  <ActivityIndicator color={theme.white} />
                ) : (
                  <Text style={styles.confirmDeleteText}>{t("common.delete")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <TripShareSheet
        visible={shareTarget != null}
        place={shareTarget ? `${shareTarget.plan.city}, ${shareTarget.plan.province}` : ""}
        lines={
          shareTarget
            ? [
                shareTarget.plan.full_name,
                t("trips.summary", {
                  date: shareTarget.plan.depart_date,
                  daysLabel: t("tripForm.dayCount", { count: shareTarget.plan.days }),
                  peopleLabel: t("tripForm.peopleCount", { count: shareTarget.plan.companions }),
                  transport: t(transportKey(shareTarget.plan.transport)),
                }),
              ]
            : []
        }
        token={shareTarget?.token ?? ""}
        onClose={() => setShareTarget(null)}
      />

      <Modal visible={importOpen} transparent animationType="slide" onRequestClose={() => setImportOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setImportOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20), gap: 10 }]}>
            <Text style={styles.confirmTitle}>{t("trips.importTitle")}</Text>
            <TextInput
              value={importCode}
              onChangeText={setImportCode}
              autoCapitalize="none"
              placeholder={t("trips.importPlaceholder")}
              placeholderTextColor="#a39890"
              style={styles.codeInput}
            />
            <Pressable
              onPress={() => void acceptShare(importCode)}
              disabled={importing}
              style={styles.confirmDelete}
              accessibilityRole="button"
            >
              {importing ? <ActivityIndicator color={theme.white} /> : <Text style={styles.confirmDeleteText}>{t("trips.import")}</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  title: {
    color: theme.ink,
    fontSize: 32,
    fontWeight: "700",
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  subtitle: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  empty: {
    color: theme.muted,
    fontSize: 15,
    lineHeight: 22,
    paddingTop: 24,
  },
  importButton: {
    marginHorizontal: 20,
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  importText: {
    color: theme.accent,
    fontWeight: "700",
  },
  cardBody: {
    flexDirection: "row",
    gap: 12,
  },
  cardCopy: {
    flex: 1,
  },
  thumb: {
    width: 88,
    borderRadius: 12,
  },
  qr: {
    alignItems: "center",
    paddingVertical: 8,
  },
  codeInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    color: theme.ink,
    backgroundColor: theme.bg,
  },
  camera: {
    height: 220,
    borderRadius: 12,
    overflow: "hidden",
  },
  card: {
    backgroundColor: theme.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 16,
    gap: 12,
  },
  name: {
    color: theme.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  meta: {
    color: theme.muted,
    fontSize: 14,
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  action: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
  },
  actionText: {
    color: theme.ink,
    fontWeight: "600",
  },
  actionDanger: {
    backgroundColor: "#fff5f3",
    borderColor: "#f0d2cb",
  },
  actionDangerText: {
    color: "#b42318",
    fontWeight: "600",
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
  },
  confirmRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(31, 26, 23, 0.35)",
    padding: 24,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: theme.card,
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },
  confirmTitle: {
    color: theme.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  confirmBody: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  confirmActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  confirmCancel: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  confirmCancelText: {
    color: theme.ink,
    fontWeight: "600",
  },
  confirmDelete: {
    minWidth: 72,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#b42318",
    alignItems: "center",
  },
  confirmDeleteText: {
    color: theme.white,
    fontWeight: "700",
  },
});
