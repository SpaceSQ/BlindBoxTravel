import { purchaseVip, type VipPlanCode } from "./api";
import i18n from "./i18n";

export const VIP_OFFERS: Array<{ code: VipPlanCode; productId: string; titleKey: string; priceKey: string }> = [
  { code: "monthly", productId: "vip_month_usd", titleKey: "purchase.monthly", priceKey: "purchase.monthlyPrice" },
  { code: "quarterly", productId: "vip_quarter_usd", titleKey: "purchase.quarterly", priceKey: "purchase.quarterlyPrice" },
  { code: "yearly", productId: "vip_year_usd", titleKey: "purchase.yearly", priceKey: "purchase.yearlyPrice" },
];

export class PurchaseCancelled extends Error {
  constructor() {
    super(i18n.t("purchase.cancelled"));
    this.name = "PurchaseCancelled";
  }
}

function isCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const userCancelled = "userCancelled" in error ? (error as { userCancelled?: unknown }).userCancelled : undefined;
  return code === "1" || code === 1 || userCancelled === true;
}

async function purchasePackage(productId: string, appUserId: string): Promise<string> {
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(i18n.t("purchase.waitingKey"));
  }
  const Purchases = (await import("react-native-purchases")).default;
  const configured = await Purchases.isConfigured();
  if (!configured) {
    Purchases.configure({ apiKey, appUserID: appUserId });
  } else {
    await Purchases.logIn(appUserId);
  }
  const offerings = await Purchases.getOfferings();
  const packages = Object.values(offerings.all).flatMap((offering) => offering.availablePackages);
  const selected = packages.find((item) => item.product.identifier === productId);
  if (!selected) {
    throw new Error(i18n.t("purchase.missingProduct"));
  }
  try {
    const result = await Purchases.purchasePackage(selected);
    const transactionId = result.transaction.transactionIdentifier?.trim();
    if (!transactionId) {
      throw new Error(i18n.t("purchase.missingTxn"));
    }
    return transactionId;
  } catch (error) {
    if (isCancelled(error)) {
      throw new PurchaseCancelled();
    }
    throw error;
  }
}

export async function completeVipPurchase(code: VipPlanCode, appUserId: string) {
  const offer = VIP_OFFERS.find((item) => item.code === code);
  if (!offer) {
    throw new Error(i18n.t("purchase.missingPlan"));
  }
  const transactionId = await purchasePackage(offer.productId, appUserId);
  return purchaseVip(code, offer.productId, transactionId);
}
