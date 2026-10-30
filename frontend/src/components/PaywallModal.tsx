import { useTranslation } from "react-i18next";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { type VipPlanCode } from "../api";
import { useAuth } from "../auth";
import { completeVipPurchase, PurchaseCancelled, VIP_OFFERS } from "../purchases";
import { errorMessage, useToast } from "./Toast";
import { theme } from "../theme";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function PaywallModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const { showToast } = useToast();
  const [buying, setBuying] = useState<VipPlanCode | null>(null);

  async function buy(code: VipPlanCode) {
    if (!user) {
      showToast(t("common.signInFirst"));
      return;
    }
    setBuying(code);
    try {
      const result = await completeVipPurchase(code, String(user.id));
      setUser(result.user);
      showToast(t("account.membershipOn"));
      onClose();
    } catch (error) {
      if (!(error instanceof PurchaseCancelled)) {
        showToast(errorMessage(error));
      }
    } finally {
      setBuying(null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{t("paywall.title")}</Text>
          <Text style={styles.body}>{t("paywall.body")}</Text>
          {VIP_OFFERS.map((offer) => (
            <Pressable
              key={offer.code}
              onPress={() => {
                void buy(offer.code);
              }}
              disabled={buying != null}
              style={styles.offer}
              accessibilityRole="button"
            >
              {buying === offer.code ? (
                <ActivityIndicator color={theme.ink} />
              ) : (
                <>
                  <Text style={styles.offerTitle}>{t(offer.titleKey)}</Text>
                  <Text style={styles.offerPrice}>{t(offer.priceKey)}</Text>
                </>
              )}
            </Pressable>
          ))}
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={styles.cancel}>{t("paywall.later")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
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
    padding: 20,
    gap: 10,
  },
  title: {
    color: theme.ink,
    fontSize: 20,
    fontWeight: "700",
  },
  body: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  offer: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.bg,
  },
  offerTitle: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  offerPrice: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: "700",
  },
  cancel: {
    textAlign: "center",
    color: theme.muted,
    paddingVertical: 8,
  },
});
