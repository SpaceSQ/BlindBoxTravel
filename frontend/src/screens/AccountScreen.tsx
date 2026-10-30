import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { deleteAccount, fetchAccount, updateNickname, type PurchaseRecord, type VipPlanCode } from "../api";
import { useAuth } from "../auth";
import { AgreementModal, type AgreementDoc } from "../components/Agreements";
import { PaywallModal } from "../components/PaywallModal";
import { errorMessage, useToast } from "../components/Toast";
import { PurchaseCancelled, VIP_OFFERS, completeVipPurchase } from "../purchases";
import { appLanguage, setAppLanguage, type AppLanguage } from "../i18n";
import { theme } from "../theme";

function LanguageSetting() {
  const { t, i18n } = useTranslation();
  const current = appLanguage(i18n.language);
  function choose(language: AppLanguage) {
    void setAppLanguage(language);
  }
  return (
    <View>
      <Text style={styles.label}>{t("account.language")}</Text>
      <View style={styles.switch}>
        {(["en-US", "zh-CN"] as const).map((language) => {
          const selected = current === language;
          const label = language === "en-US" ? t("account.languageEn") : t("account.languageZh");
          return (
            <Pressable
              key={language}
              onPress={() => choose(language)}
              style={[styles.switchItem, selected && styles.switchOn]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.switchText, selected && styles.switchTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function AccountScreen() {
  const { t } = useTranslation();
  const { user, ready, signInWithApple, signInAsDev, signOut, setUser } = useAuth();
  const { showToast } = useToast();
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [needAgreement, setNeedAgreement] = useState(false);
  const [doc, setDoc] = useState<AgreementDoc | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  useEffect(() => {
    setNickname(user?.nickname ?? "");
  }, [user?.id, user?.nickname]);

  const userId = user?.id;
  const loadPurchases = useCallback(async () => {
    if (!userId) {
      setPurchases([]);
      return;
    }
    const account = await fetchAccount();
    setUser(account.user);
    setPurchases(account.purchases);
  }, [setUser, userId]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        return;
      }
      void loadPurchases().catch((error) => showToast(errorMessage(error)));
    }, [loadPurchases, showToast, userId]),
  );

  function ensureAgreed() {
    if (agreed) {
      return true;
    }
    setNeedAgreement(true);
    return false;
  }

  async function saveNickname() {
    const next = nickname.trim();
    if (!next) {
      showToast(t("account.nicknameEmpty"));
      return;
    }
    setBusy(true);
    try {
      const result = await updateNickname(next);
      setUser(result.user);
      showToast(t("account.nicknameSaved"));
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function buy(code: VipPlanCode) {
    if (!user) {
      return;
    }
    setBusy(true);
    try {
      const result = await completeVipPurchase(code, String(user.id));
      setUser(result.user);
      setPurchases(result.purchases);
      showToast(t("account.membershipOn"));
    } catch (error) {
      if (!(error instanceof PurchaseCancelled)) {
        showToast(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function apple() {
    if (!ensureAgreed()) {
      return;
    }
    setBusy(true);
    try {
      await signInWithApple();
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function continueAsTestUser() {
    if (!__DEV__) {
      return;
    }
    setBusy(true);
    try {
      await signInAsDev();
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function signedInLabel() {
    if (!user) {
      return "";
    }
    if (user.phone) {
      return user.phone;
    }
    if (user.sign_in === "google") {
      return t("account.google");
    }
    return t("account.apple");
  }

  async function removeAccount() {
    setBusy(true);
    try {
      await deleteAccount();
      await signOut();
      setDeleteOpen(false);
      showToast(t("account.deleted"));
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.ink} />
      </View>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{t("account.title")}</Text>
          <Text style={styles.lead}>{t("account.appleLead")}</Text>
          <LanguageSetting />
          <Pressable
            onPress={() => {
              void apple();
            }}
            disabled={busy}
            style={styles.apple}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.appleText}>{t("account.signInApple")}</Text>
            )}
          </Pressable>
          {__DEV__ ? (
            <Pressable
              onPress={() => {
                void continueAsTestUser();
              }}
              disabled={busy}
              style={styles.dev}
              accessibilityRole="button"
            >
              <Text style={styles.devText}>{t("account.devLogin")}</Text>
            </Pressable>
          ) : null}
          <View style={styles.agreeRow}>
            <Pressable
              onPress={() => setAgreed((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              hitSlop={8}
            >
              <View style={[styles.box, agreed && styles.boxOn]}>{agreed ? <Text style={styles.tick}>✓</Text> : null}</View>
            </Pressable>
            <Text style={styles.agreeText}>
              {t("account.agreePrefix")}
              <Text style={styles.agreeLink} onPress={() => setDoc("terms")}>
                {t("account.terms")}
              </Text>
              {t("account.and")}
              <Text style={styles.agreeLink} onPress={() => setDoc("privacy")}>
                {t("account.privacy")}
              </Text>
            </Text>
          </View>
        </ScrollView>
        <AgreementModal doc={doc} onClose={() => setDoc(null)} />
        <Modal visible={needAgreement} transparent animationType="fade" onRequestClose={() => setNeedAgreement(false)}>
          <View style={styles.dialogRoot}>
            <View style={styles.dialog}>
              <Text style={styles.dialogTitle}>{t("account.agreeTitle")}</Text>
              <Pressable onPress={() => setNeedAgreement(false)} style={styles.button} accessibilityRole="button">
                <Text style={styles.buttonText}>{t("account.gotIt")}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("account.title")}</Text>
        <LanguageSetting />
        <Text style={styles.phone}>{signedInLabel()}</Text>
        <Text style={styles.quota}>
          {t("account.quota", { used: Math.min(user.unlock_count, user.unlock_limit), limit: user.unlock_limit })}
        </Text>
        <Text style={styles.vip}>
          {user.is_vip ? t("account.vipUntil", { date: user.vip_expires_at ?? "" }) : t("account.freeUser")}
        </Text>
        <Text style={styles.label}>{t("account.nickname")}</Text>
        <TextInput
          value={nickname}
          onChangeText={setNickname}
          style={styles.field}
          placeholder={t("account.nickname")}
          placeholderTextColor="#a39890"
        />
        <Pressable onPress={() => void saveNickname()} disabled={busy} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>{t("account.saveProfile")}</Text>
        </Pressable>
        <Text style={styles.label}>{t("account.plans")}</Text>
        {VIP_OFFERS.map((offer) => (
          <Pressable
            key={offer.code}
            onPress={() => void buy(offer.code)}
            disabled={busy}
            style={styles.offer}
            accessibilityRole="button"
          >
            <Text style={styles.offerTitle}>{t(offer.titleKey)}</Text>
            <Text style={styles.offerPrice}>{t(offer.priceKey)}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setPaywall(true)} accessibilityRole="button">
          <Text style={styles.link}>{t("account.seePlans")}</Text>
        </Pressable>
        <Text style={styles.label}>{t("account.history")}</Text>
        {purchases.length === 0 ? <Text style={styles.empty}>{t("account.noPurchases")}</Text> : null}
        {purchases.map((item) => (
          <View key={item.id} style={styles.record}>
            <Text style={styles.recordTitle}>
              {t("account.purchaseLine", { title: item.title, amount: item.amount_usd.toFixed(2) })}
            </Text>
            <Text style={styles.recordMeta}>{item.purchased_at}</Text>
          </View>
        ))}
        <Pressable onPress={() => void signOut()} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>{t("account.signOut")}</Text>
        </Pressable>
        <View style={styles.dangerZone}>
          <Text style={styles.dangerLabel}>{t("account.dangerZone")}</Text>
          <Pressable
            onPress={() => {
              setDeleteText("");
              setDeleteOpen(true);
            }}
            style={styles.dangerButton}
            accessibilityRole="button"
          >
            <Text style={styles.dangerButtonText}>{t("account.delete")}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <PaywallModal visible={paywall} onClose={() => setPaywall(false)} />
      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
        <View style={styles.dialogRoot}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{t("account.deleteTitle")}</Text>
            <Text style={styles.dialogHint}>{t("account.deleteHint")}</Text>
            <TextInput
              value={deleteText}
              onChangeText={setDeleteText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="DELETE"
              placeholderTextColor="#a39890"
              style={styles.field}
            />
            <Pressable
              onPress={() => void removeAccount()}
              disabled={busy || deleteText !== "DELETE"}
              style={[styles.dangerButton, deleteText !== "DELETE" && styles.buttonOff]}
              accessibilityRole="button"
            >
              <Text style={styles.dangerButtonText}>{t("account.deleteConfirm")}</Text>
            </Pressable>
            <Pressable onPress={() => setDeleteOpen(false)} accessibilityRole="button">
              <Text style={styles.secondaryText}>{t("account.deleteLater")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg },
  content: { padding: 20, gap: 10, paddingBottom: 32 },
  title: { color: theme.ink, fontSize: 32, fontWeight: "700" },
  lead: { color: theme.muted, fontSize: 15, lineHeight: 22 },
  phone: { color: theme.muted, fontSize: 15 },
  quota: { color: theme.ink, fontSize: 16, fontWeight: "700" },
  vip: { color: theme.accent, fontSize: 14 },
  label: { color: theme.muted, fontSize: 13, fontWeight: "600", marginTop: 8 },
  field: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    backgroundColor: theme.card,
    color: theme.ink,
    fontSize: 16,
  },
  button: { height: 52, borderRadius: 16, backgroundColor: theme.ink, alignItems: "center", justifyContent: "center" },
  buttonText: { color: theme.white, fontWeight: "700", fontSize: 16 },
  secondary: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.card,
  },
  secondaryText: { color: theme.ink, fontWeight: "600" },
  switch: { flexDirection: "row", gap: 8 },
  switchItem: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
  },
  switchOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  switchText: { color: theme.ink, fontWeight: "600" },
  switchTextOn: { color: theme.white },
  apple: {
    height: 52,
    borderRadius: 8,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  appleText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  dev: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.card,
  },
  devText: { color: theme.accent, fontSize: 17, fontWeight: "700" },
  agreeRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 4 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.ink,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.card,
  },
  boxOn: { backgroundColor: theme.ink },
  tick: { color: theme.white, fontSize: 14, fontWeight: "700" },
  agreeText: { flex: 1, color: theme.muted, fontSize: 13, lineHeight: 20 },
  agreeLink: { color: theme.accent, fontWeight: "700" },
  dialogRoot: {
    flex: 1,
    backgroundColor: "rgba(31, 26, 23, 0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  dialog: { width: "100%", backgroundColor: theme.card, borderRadius: 18, padding: 18, gap: 12 },
  dialogTitle: { color: theme.ink, fontSize: 16, lineHeight: 24, fontWeight: "700" },
  dangerZone: { marginTop: 28, gap: 10, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.line },
  dangerLabel: { color: "#b42318", fontSize: 13, fontWeight: "700", letterSpacing: 0.4 },
  dangerButton: {
    height: 52,
    borderRadius: 12,
    backgroundColor: "#b42318",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  buttonOff: { opacity: 0.4 },
  dialogHint: { color: theme.muted, fontSize: 14 },
  offer: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  offerTitle: { color: theme.ink, fontWeight: "700" },
  offerPrice: { color: theme.accent, fontWeight: "700" },
  link: { color: theme.accent, fontWeight: "600" },
  empty: { color: theme.muted },
  record: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.line, padding: 12 },
  recordTitle: { color: theme.ink, fontWeight: "600" },
  recordMeta: { color: theme.muted, fontSize: 12, marginTop: 4 },
});
