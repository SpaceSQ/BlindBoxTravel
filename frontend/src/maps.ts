import { Linking, Platform } from "react-native";

export async function openDirections(lat: number, lng: number): Promise<void> {
  const apple = `http://maps.apple.com/?daddr=${lat},${lng}`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const url = Platform.OS === "ios" ? apple : google;
  await Linking.openURL(url);
}
