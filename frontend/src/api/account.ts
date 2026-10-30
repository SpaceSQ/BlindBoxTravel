import { http } from "./http";
import type { AccountUser, PurchaseRecord, VipPlanCode } from "./types";

export type AuthResponse = {
  token: string;
  user: AccountUser;
};

export type AccountResponse = {
  user: AccountUser;
  purchases: PurchaseRecord[];
  plans: Record<VipPlanCode, { title: string; amount_cents: number; months: number; product_id: string }>;
};

export function registerAccount(body: { phone: string; password: string; nickname?: string }): Promise<AuthResponse> {
  return http.post<AuthResponse>("/api/auth/register", body).then((response) => response.data);
}

export function loginAccount(body: { phone: string; password: string }): Promise<AuthResponse> {
  return http.post<AuthResponse>("/api/auth/login", body).then((response) => response.data);
}

export function fetchAccount(): Promise<AccountResponse> {
  return http.get<AccountResponse>("/api/account").then((response) => response.data);
}

export function updateNickname(nickname: string): Promise<{ user: AccountUser }> {
  return http.patch<{ user: AccountUser }>("/api/account", { nickname }).then((response) => response.data);
}

export function loginDev(): Promise<AuthResponse> {
  return http.post<AuthResponse>("/api/auth/dev").then((response) => response.data);
}

export function loginWithApple(body: { identity_token: string; nickname?: string }): Promise<AuthResponse> {
  return http.post<AuthResponse>("/api/auth/apple", body).then((response) => response.data);
}

export function loginWithGoogle(body: { identity_token: string; nickname?: string }): Promise<AuthResponse> {
  return http.post<AuthResponse>("/api/auth/google", body).then((response) => response.data);
}

export function purchaseVip(
  planCode: VipPlanCode,
  productId: string,
  storeTransactionId: string,
): Promise<{ user: AccountUser; purchases: PurchaseRecord[] }> {
  return http
    .post<{ user: AccountUser; purchases: PurchaseRecord[] }>("/api/account/purchases", {
      plan_code: planCode,
      product_id: productId,
      store_transaction_id: storeTransactionId,
    })
    .then((response) => response.data);
}

export function deleteAccount(): Promise<void> {
  return http.delete("/api/account").then(() => undefined);
}