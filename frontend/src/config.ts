import { Platform } from "react-native";

import type { Origin } from "./api/types";

/** Used when location permission is off or the lookup fails. */
export const DEFAULT_ORIGIN: Origin = { lat: 40.7128, lng: -74.006 };

const HOST_LOOPBACK = "http://127.0.0.1:8000";
// Android 模拟器里的 127.0.0.1 指向模拟器自己，宿主机要用 10.0.2.2。
const ANDROID_EMULATOR_HOST = "http://10.0.2.2:8000";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 默认连本机 FastAPI。
 * 真机调试时在环境变量里设置 EXPO_PUBLIC_API_BASE_URL 为电脑的局域网地址。
 */
export function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) {
    return trimSlash(fromEnv);
  }
  if (Platform.OS === "android") {
    return ANDROID_EMULATOR_HOST;
  }
  return HOST_LOOPBACK;
}

export const API_BASE_URL = resolveApiBaseUrl();
