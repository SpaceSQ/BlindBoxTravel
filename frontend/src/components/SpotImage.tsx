import { useEffect, useState } from "react";
import { Image, View, type ImageStyle, type StyleProp, StyleSheet } from "react-native";

export type ImageAspect = "wide" | "photo" | "square" | "fill";

const ASPECT: Record<Exclude<ImageAspect, "fill">, number> = {
  wide: 16 / 9,
  photo: 4 / 3,
  square: 1,
};

type Props = {
  spotId: string;
  imageUrl: string | null;
  aspect?: ImageAspect;
  style?: StyleProp<ImageStyle>;
};

const UNUSABLE_IMAGE = /\.(?:pdf|svg|tif|tiff|html?)(?:$|\?)/i;

export function isUsableImage(url: string | null | undefined): url is string {
  if (!url || !/^https?:\/\//i.test(url)) {
    return false;
  }
  if (/example\.com/i.test(url) || UNUSABLE_IMAGE.test(url)) {
    return false;
  }
  return true;
}

const TRAVEL_PHOTOS = [
  "1507525428034-b723cf961d3e",
  "1469474968028-56623f02e42e",
  "1501785888041-af3ef285b470",
  "1470770841072-f978cf4d019e",
  "1441974231531-c6227db76b6e",
  "1476514525535-07fb3b4ae5f1",
  "1439066615861-d1af74d74000",
  "1469854523086-cc02fe5d8800",
  "1500530855697-b586d89ba3ee",
  "1472214103451-9374bd1c798e",
];

/** 同一景点始终落在同一张图上，不同位置只改变裁切比例。 */
export function photoForSpot(spotId: string): string {
  let hash = 0;
  for (const char of spotId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const id = TRAVEL_PHOTOS[hash % TRAVEL_PHOTOS.length];
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;
}

export function SpotImage({ spotId, imageUrl, aspect = "wide", style }: Props) {
  const real = isUsableImage(imageUrl) ? imageUrl : null;
  const [uri, setUri] = useState<string | null>(real);
  const frame = [styles.frame, aspect === "fill" ? styles.fill : { aspectRatio: ASPECT[aspect] }, style];

  useEffect(() => {
    setUri(real);
  }, [spotId, real]);

  if (!uri) {
    return <View style={frame} />;
  }

  return (
    <Image
      key={`${spotId}:${uri}`}
      source={{ uri }}
      resizeMode="cover"
      style={frame}
      onError={() => {
        if (!real) {
          return;
        }
        const fallback = photoForSpot(spotId);
        setUri((current) => (current === fallback ? current : fallback));
      }}
    />
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    backgroundColor: "#efe8e0",
  },
  fill: {
    height: "100%",
  },
});
