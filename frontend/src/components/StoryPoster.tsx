import { forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import { SpotImage } from "./SpotImage";

const WIDTH = 360;
const HEIGHT = 640;
const SHADE = [0.05, 0.12, 0.22, 0.36, 0.52, 0.7, 0.86];

type Props = {
  spotId: string;
  imageUrl: string | null;
  name: string;
  tags: string[];
};

export const StoryPoster = forwardRef<View, Props>(function StoryPoster({ spotId, imageUrl, name, tags }, ref) {
  return (
    <View ref={ref} collapsable={false} style={styles.frame}>
      <SpotImage spotId={spotId} imageUrl={imageUrl} aspect="fill" style={styles.photo} />
      <View style={styles.shade} pointerEvents="none">
        {SHADE.map((opacity) => (
          <View key={opacity} style={[styles.band, { backgroundColor: `rgba(0,0,0,${opacity})` }]} />
        ))}
      </View>
      <Text style={styles.brand}>MYSTERY GETAWAY</Text>
      <View style={styles.copy}>
        {tags.slice(0, 3).map((tag) => (
          <Text key={tag} style={styles.tag}>
            {tag}
          </Text>
        ))}
        <Text style={styles.name}>{name}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: "#120f0d",
    overflow: "hidden",
  },
  photo: {
    ...StyleSheet.absoluteFill,
    width: WIDTH,
    height: HEIGHT,
  },
  shade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: HEIGHT * 0.55,
  },
  band: {
    flex: 1,
  },
  brand: {
    position: "absolute",
    top: 28,
    left: 24,
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2,
  },
  copy: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 36,
    gap: 8,
  },
  tag: {
    alignSelf: "flex-start",
    color: "#fff",
    backgroundColor: "rgba(232,93,4,0.92)",
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    fontSize: 14,
    fontWeight: "700",
  },
  name: {
    color: "#fff",
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
  },
});
