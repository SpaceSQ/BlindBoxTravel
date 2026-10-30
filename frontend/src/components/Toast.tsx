import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { ApiError } from "../api/http";
import i18n from "../i18n";
import { theme } from "../theme";

type ToastContextValue = {
  showToast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.message.trim()) {
    return error.message;
  }
  return i18n.t("common.genericError");
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (text: string) => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      setMessage(text);
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(({ finished }) => {
          if (finished) {
            setMessage(null);
          }
        });
      }, 2800);
    },
    [opacity],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      <View style={styles.host}>
        {children}
        {message ? (
          <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
            <Text style={styles.toastText}>{message}</Text>
          </Animated.View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return value;
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  toast: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 36,
    zIndex: 40,
    backgroundColor: theme.ink,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  toastText: {
    color: theme.white,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
