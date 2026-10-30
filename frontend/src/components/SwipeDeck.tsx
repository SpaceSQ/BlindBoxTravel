import { useTranslation } from "react-i18next";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Animated, PanResponder, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { RadarSpot } from "../api";
import { tagLabel } from "../tagLabel";
import { SpotImage } from "./SpotImage";

const SWIPE_X = 110;

export type SwipeDeckHandle = {
  fly: (direction: "left" | "right") => void;
};

type Props = {
  spot: RadarSpot | null;
  nextSpot?: RadarSpot | null;
  enabled: boolean;
  onBeforeSwipe?: (direction: "left" | "right") => boolean;
  onSwiped: (direction: "left" | "right") => void;
};

const SHADE = [0.08, 0.16, 0.28, 0.42, 0.58, 0.74, 0.88];

function CardFace({ spot }: { spot: RadarSpot }) {
  const { i18n } = useTranslation();
  const tags = spot.tags.filter((tag) => tag.strength === "strong").slice(0, 3);
  return (
    <View style={styles.face}>
      <SpotImage key={spot.spot_id} spotId={spot.spot_id} imageUrl={spot.image_url} aspect="fill" style={styles.photo} />
      <View style={styles.shade} pointerEvents="none">
        {SHADE.map((opacity) => (
          <View key={opacity} style={[styles.band, { backgroundColor: `rgba(0,0,0,${opacity})` }]} />
        ))}
      </View>
      <View style={styles.copy} pointerEvents="none">
        {tags.map((tag) => (
          <Text key={tag.name} style={styles.tag}>
            {tagLabel(tag, i18n.language)}
          </Text>
        ))}
        <Text style={styles.name}>{spot.display_name}</Text>
      </View>
    </View>
  );
}

export const SwipeDeck = forwardRef<SwipeDeckHandle, Props>(function SwipeDeck(
  { spot, nextSpot, enabled, onBeforeSwipe, onSwiped },
  ref,
) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const pan = useRef(new Animated.ValueXY()).current;
  const flying = useRef(false);
  const enabledRef = useRef(enabled);
  const beforeRef = useRef(onBeforeSwipe);
  const swipedRef = useRef(onSwiped);
  enabledRef.current = enabled;
  beforeRef.current = onBeforeSwipe;
  swipedRef.current = onSwiped;

  useLayoutEffect(() => {
    pan.setValue({ x: 0, y: 0 });
    flying.current = false;
  }, [pan, spot?.spot_id]);

  function fly(direction: "left" | "right") {
    if (!spot || flying.current || !enabledRef.current) {
      return;
    }
    if (beforeRef.current && beforeRef.current(direction) === false) {
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false, bounciness: 8 }).start();
      return;
    }
    flying.current = true;
    const x = direction === "right" ? width + 40 : -width - 40;
    Animated.timing(pan, {
      toValue: { x, y: 36 },
      duration: 240,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        swipedRef.current(direction);
      } else {
        flying.current = false;
      }
    });
  }

  useImperativeHandle(ref, () => ({ fly }), [spot, width, pan]);

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        enabledRef.current && !flying.current && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gesture) => {
        if (!enabledRef.current || flying.current) {
          return;
        }
        if (gesture.dx > SWIPE_X) {
          fly("right");
          return;
        }
        if (gesture.dx < -SWIPE_X) {
          fly("left");
          return;
        }
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false, bounciness: 8 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      },
    }),
  ).current;

  const rotate = pan.x.interpolate({
    inputRange: [-220, 0, 220],
    outputRange: ["-12deg", "0deg", "12deg"],
  });
  const likeOpacity = pan.x.interpolate({
    inputRange: [0, SWIPE_X],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const nopeOpacity = pan.x.interpolate({
    inputRange: [-SWIPE_X, 0],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  if (!spot) {
    return null;
  }

  return (
    <View style={styles.stack}>
      {nextSpot ? (
        <View style={[styles.card, styles.under]} pointerEvents="none">
          <CardFace spot={nextSpot} />
        </View>
      ) : null}
      <Animated.View
        style={[styles.card, { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] }]}
        {...responder.panHandlers}
      >
        <CardFace spot={spot} />
        <Animated.View style={[styles.stamp, styles.likeStamp, { opacity: likeOpacity }]} pointerEvents="none">
          <Text style={[styles.stampText, styles.likeText]}>{t("radar.like")}</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.nopeStamp, { opacity: nopeOpacity }]} pointerEvents="none">
          <Text style={[styles.stampText, styles.nopeText]}>{t("radar.skip")}</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  stack: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "100%",
    height: "100%",
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#1b1714",
  },
  under: {
    position: "absolute",
    transform: [{ scale: 0.94 }, { translateY: 16 }],
    opacity: 0.9,
  },
  face: {
    flex: 1,
  },
  photo: {
    ...StyleSheet.absoluteFill,
  },
  shade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "62%",
    justifyContent: "flex-end",
  },
  band: {
    flex: 1,
  },
  copy: {
    position: "absolute",
    left: 22,
    right: 22,
    bottom: 28,
  },
  tag: {
    color: "#fff",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
  },
  name: {
    marginTop: 10,
    color: "rgba(255,255,255,0.88)",
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "700",
  },
  stamp: {
    position: "absolute",
    top: 28,
    borderWidth: 4,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  likeStamp: {
    left: 20,
    borderColor: "#3ddc97",
    transform: [{ rotate: "-12deg" }],
  },
  nopeStamp: {
    right: 20,
    borderColor: "#ff5a5f",
    transform: [{ rotate: "12deg" }],
  },
  stampText: {
    fontSize: 28,
    fontWeight: "800",
  },
  likeText: {
    color: "#3ddc97",
  },
  nopeText: {
    color: "#ff5a5f",
  },
});
