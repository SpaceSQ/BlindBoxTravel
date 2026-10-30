import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { en } from "./en";
import { zh } from "./zh";

export const LANGUAGE_KEY = "mysterygetaway.language";
export type AppLanguage = "en-US" | "zh-CN";

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": { translation: en },
    "zh-CN": { translation: zh },
  },
  lng: "en-US",
  fallbackLng: "en-US",
  interpolation: { escapeValue: false },
});

export function appLanguage(language: string): AppLanguage {
  return language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export async function setAppLanguage(language: AppLanguage): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
  await i18n.changeLanguage(language);
}

void AsyncStorage.getItem(LANGUAGE_KEY).then((saved) => {
  if (saved === "en-US" || saved === "zh-CN") {
    void i18n.changeLanguage(saved);
  }
});

export default i18n;
