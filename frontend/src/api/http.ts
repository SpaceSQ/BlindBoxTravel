import axios, { AxiosError, type AxiosInstance } from "axios";

import { API_BASE_URL } from "../config";
import i18n from "../i18n";

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

type ErrorBody = {
  detail?: unknown;
};

function messageFromDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: unknown } | undefined;
    if (typeof first?.msg === "string" && first.msg.trim()) {
      return first.msg;
    }
  }
  return fallback;
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

http.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ErrorBody>) => {
    if (error.response) {
      const detail = error.response.data?.detail;
      throw new ApiError(messageFromDetail(detail, i18n.t("common.requestFailed")), error.response.status, detail ?? null);
    }
    if (error.code === "ECONNABORTED") {
      throw new ApiError(i18n.t("common.timeout"), 0, null);
    }
    throw new ApiError(i18n.t("common.offline", { url: API_BASE_URL }), 0, null);
  },
);
