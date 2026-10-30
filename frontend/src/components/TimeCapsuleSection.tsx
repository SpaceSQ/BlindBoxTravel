import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";

import { ApiError, fetchCapsules, publishCapsule, type TimeCapsule, type UnlockedSpot } from "../api";
import { API_BASE_URL } from "../config";
import { errorMessage, useToast } from "./Toast";
import { ensureLocationNotice } from "../locationConsent";
import { theme } from "../theme";
import { formatMiles, kmToMiles } from "../units";

const RADIUS_KM = 5;

type Fix =
  | { status: "locating" }
  | { status: "denied" }
  | { status: "ready"; km: number; lat: number; lng: number };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

function distanceText(km: number, unit: string): string {
  return formatMiles(kmToMiles(km), unit);
}

export function TimeCapsuleSection({ spot }: { spot: UnlockedSpot }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capsules, setCapsules] = useState<TimeCapsule[]>([]);
  const [fix, setFix] = useState<Fix>({ status: "locating" });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [publishing, setPublishing] = useState(false);

  const loadCapsules = useCallback(async () => {
    const items = await fetchCapsules(spot.spot_id);
    setCapsules(items);
  }, [spot.spot_id]);

  const locate = useCallback(async () => {
    setFix({ status: "locating" });
    const allowed = await ensureLocationNotice();
    if (!allowed) {
      setFix({ status: "denied" });
      return;
    }
    const permissionResult = await Location.requestForegroundPermissionsAsync();
    if (permissionResult.status !== "granted") {
      setFix({ status: "denied" });
      return;
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const km = haversineKm(position.coords.latitude, position.coords.longitude, spot.location.lat, spot.location.lng);
    setFix({ status: "ready", km, lat: position.coords.latitude, lng: position.coords.longitude });
  }, [spot.location.lat, spot.location.lng]);

  useEffect(() => {
    void loadCapsules().catch((error) => showToast(error instanceof ApiError ? error.message : errorMessage(error)));
    void locate().catch(() => setFix({ status: "denied" }));
  }, [loadCapsules, locate, showToast]);

  const inside = fix.status === "ready" && fix.km < RADIUS_KM;

  async function openCamera() {
    if (!inside) {
      return;
    }
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) {
        showToast(t("capsule.cameraDenied"));
        return;
      }
    }
    setPhotoUri(null);
    setContent("");
    setCameraOpen(true);
  }

  async function shoot() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
    if (!photo?.uri) {
      showToast(t("capsule.noPhoto"));
      return;
    }
    setPhotoUri(photo.uri);
  }

  async function send(uri: string, text: string) {
    setPublishing(true);
    try {
      const allowed = await ensureLocationNotice();
      if (!allowed) {
        setFix({ status: "denied" });
        return;
      }
      const permissionResult = await Location.requestForegroundPermissionsAsync();
      if (permissionResult.status !== "granted") {
        setFix({ status: "denied" });
        showToast(t("capsule.locationDenied"));
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const km = haversineKm(lat, lng, spot.location.lat, spot.location.lng);
      setFix({ status: "ready", km, lat, lng });
      if (km >= RADIUS_KM) {
        showToast(t("capsule.tooFar"));
        return;
      }
      await publishCapsule(spot.spot_id, { content: text, lat, lng, imageUri: uri });
      setCameraOpen(false);
      setPhotoUri(null);
      setContent("");
      await loadCapsules();
      showToast(t("capsule.saved"));
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : errorMessage(error));
    } finally {
      setPublishing(false);
    }
  }

  const hint =
    fix.status === "locating"
      ? t("capsule.locating")
      : fix.status === "denied"
        ? t("capsule.locationDenied")
        : fix.km < RADIUS_KM
          ? t("capsule.inside")
          : t("capsule.outside", { distance: distanceText(fix.km, t("common.mileUnit")) });

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{t("capsule.title")}</Text>
      <Text style={styles.lead}>{t("capsule.lead")}</Text>
      {capsules.length === 0 ? (
        <Text style={styles.empty}>{t("capsule.empty")}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {capsules.map((item) => (
            <View key={item.capsule_id} style={styles.card}>
              <Image source={{ uri: mediaUrl(item.image_url) }} style={styles.photo} />
              <Text style={styles.content} numberOfLines={3}>
                {item.content}
              </Text>
              <Text style={styles.author}>{item.author}</Text>
            </View>
          ))}
        </ScrollView>
      )}
      <Text style={styles.hint}>{hint}</Text>
      <Pressable
        onPress={() => {
          void openCamera();
        }}
        disabled={!inside}
        style={[styles.publish, !inside && styles.publishOff]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !inside }}
      >
        <Text style={styles.publishText}>{t("capsule.publish")}</Text>
      </Pressable>

      <Modal visible={cameraOpen} animationType="slide" onRequestClose={() => setCameraOpen(false)}>
        <View style={styles.cameraLayer}>
          {photoUri ? (
            <View style={styles.preview}>
              <Image source={{ uri: photoUri }} style={styles.previewPhoto} />
              <TextInput
                value={content}
                onChangeText={(value) => setContent(value.slice(0, 50))}
                placeholder={t("capsule.placeholder")}
                placeholderTextColor="#a39890"
                maxLength={50}
                multiline
                style={styles.input}
              />
              <Text style={styles.count}>{content.trim().length}/50</Text>
              <Pressable
                onPress={() => {
                  if (!photoUri) {
                    return;
                  }
                  const text = content.trim();
                  if (!text || text.length > 50) {
                    showToast(t("capsule.needNote"));
                    return;
                  }
                  void send(photoUri, text);
                }}
                disabled={publishing || fix.status !== "ready" || fix.km >= RADIUS_KM}
                style={styles.publish}
                accessibilityRole="button"
              >
                {publishing ? <ActivityIndicator color={theme.white} /> : <Text style={styles.publishText}>{t("capsule.post")}</Text>}
              </Pressable>
              <Pressable onPress={() => setPhotoUri(null)} accessibilityRole="button">
                <Text style={styles.secondary}>{t("capsule.retake")}</Text>
              </Pressable>
              <Pressable onPress={() => setCameraOpen(false)} accessibilityRole="button">
                <Text style={styles.secondary}>{t("common.close")}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.preview}>
              <CameraView ref={cameraRef} style={styles.viewfinder} facing="back" />
              <Pressable onPress={() => void shoot()} style={styles.shutter} accessibilityRole="button" accessibilityLabel={t("capsule.shoot")}>
                <Text style={styles.publishText}>{t("capsule.shoot")}</Text>
              </Pressable>
              <Pressable onPress={() => setCameraOpen(false)} accessibilityRole="button">
                <Text style={styles.secondary}>{t("common.close")}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, gap: 10 },
  title: { color: theme.ink, fontSize: 18, fontWeight: "700" },
  lead: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  empty: { color: theme.muted, fontSize: 14 },
  row: { gap: 12, paddingVertical: 4 },
  card: { width: 180, backgroundColor: theme.card, borderRadius: 16, overflow: "hidden" },
  photo: { width: "100%", height: 132, backgroundColor: theme.chip },
  content: { paddingHorizontal: 12, paddingTop: 10, color: theme.ink, fontSize: 14, lineHeight: 20 },
  author: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 6, color: theme.muted, fontSize: 12 },
  hint: { color: theme.muted, fontSize: 13, lineHeight: 20 },
  publish: {
    height: 48,
    borderRadius: 14,
    backgroundColor: theme.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  publishOff: { opacity: 0.4 },
  publishText: { color: theme.white, fontWeight: "700", fontSize: 16 },
  cameraLayer: {
    flex: 1,
    backgroundColor: "#120f0d",
  },
  preview: { flex: 1, padding: 16, justifyContent: "flex-end", gap: 10 },
  viewfinder: { flex: 1, borderRadius: 20, overflow: "hidden", marginBottom: 12 },
  previewPhoto: { flex: 1, borderRadius: 20, marginBottom: 8 },
  input: {
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: theme.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: theme.ink,
    fontSize: 16,
  },
  count: { color: "#d9d0c7", textAlign: "right" },
  shutter: {
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { color: "#fff", textAlign: "center", paddingVertical: 8, fontWeight: "700" },
});
