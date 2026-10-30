import { Linking, Platform, Share, type View } from "react-native";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";

import i18n from "./i18n";
import { qrModules } from "./qr";

export function spotLink(spotId: string): string {
  return `mysterygetaway://spot/${encodeURIComponent(spotId)}`;
}

export function tripLink(token: string): string {
  return `mysterygetaway://trip/${encodeURIComponent(token)}`;
}

export function tripPageUrl(token: string): string {
  const path = `/trip/${encodeURIComponent(token)}`;
  const origin = typeof window !== "undefined" ? window.location?.origin : "";
  if (origin && origin !== "null") {
    return `${origin}${path}`;
  }
  return tripLink(token);
}

export function tokenFromShareText(value: string): string {
  const appLink = value.match(/mysterygetaway:\/\/trip\/([^/?#\s]+)/i);
  if (appLink?.[1]) {
    return decodeURIComponent(appLink[1]);
  }
  const webLink = value.match(/\/trip\/([^/?#\s]+)/i);
  if (webLink?.[1]) {
    return decodeURIComponent(webLink[1]);
  }
  return value.trim();
}

export function tripShareMessage(place: string, token: string): string {
  return i18n.t("share.trip", { place, link: tripPageUrl(token) });
}

export function xPostUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function facebookPostUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

export function tripPosterDataUrl(input: { place: string; lines: string[]; link: string }): string {
  const doc = typeof document === "undefined" ? null : document;
  if (!doc) {
    throw new Error(i18n.t("share.storyUnavailable"));
  }
  const canvas = doc.createElement("canvas");
  canvas.width = 800;
  canvas.height = 1100;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error(i18n.t("share.storyUnavailable"));
  }
  ctx.fillStyle = "#f6f3ee";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1f1a17";
  ctx.font = "700 28px sans-serif";
  ctx.fillText("Mystery Getaway", 56, 78);
  ctx.font = "700 40px sans-serif";
  const title = wrapLine(ctx, input.place, 688).slice(0, 3);
  title.forEach((line, index) => ctx.fillText(line, 56, 150 + index * 48));
  ctx.fillStyle = "#6f655e";
  ctx.font = "24px sans-serif";
  let cursor = 170 + title.length * 48;
  for (const line of input.lines) {
    for (const wrapped of wrapLine(ctx, line, 688).slice(0, 2)) {
      ctx.fillText(wrapped, 56, cursor);
      cursor += 36;
    }
  }
  const modules = qrModules(input.link);
  const quiet = 4;
  const cell = 10;
  const qrSide = (modules.length + quiet * 2) * cell;
  const originX = Math.round((canvas.width - qrSide) / 2);
  const originY = 620;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(originX, originY, qrSide, qrSide);
  ctx.fillStyle = "#1f1a17";
  modules.forEach((row, rowIndex) => {
    row.forEach((dark, colIndex) => {
      if (dark) {
        ctx.fillRect(originX + (colIndex + quiet) * cell, originY + (rowIndex + quiet) * cell, cell, cell);
      }
    });
  });
  ctx.fillStyle = "#6f655e";
  ctx.font = "20px sans-serif";
  const caption = wrapLine(ctx, i18n.t("share.scan"), 688);
  caption.forEach((line, index) => ctx.fillText(line, 56, originY + qrSide + 48 + index * 30));
  return canvas.toDataURL("image/png");
}

export async function saveTripPoster(
  view: View | null,
  input: { place: string; lines: string[]; link: string },
): Promise<void> {
  if (Platform.OS === "web") {
    const url = tripPosterDataUrl(input);
    const doc = document;
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.download = "mystery-getaway-trip.png";
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }
  if (!view) {
    throw new Error(i18n.t("share.storyUnavailable"));
  }
  const uri = await captureRef(view, { format: "png", quality: 1, result: "tmpfile" });
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error(i18n.t("share.storyUnavailable"));
  }
  await Sharing.shareAsync(uri, {
    mimeType: "image/png",
    UTI: "public.png",
    dialogTitle: i18n.t("share.saveImage"),
  });
}

function mileText(distance: number): string {
  return distance >= 100 ? String(Math.round(distance)) : distance.toFixed(1);
}

export async function shareInvite(input: { spotId?: string; token?: string; distance?: number }): Promise<void> {
  const link = input.token ? tripLink(input.token) : spotLink(input.spotId ?? "");
  const message =
    input.distance == null
      ? i18n.t("share.mysteryNearby", { link })
      : i18n.t("share.mystery", { distance: mileText(input.distance), link });
  const result = await Share.share({ message });
  if (result.action === Share.dismissedAction) {
    return;
  }
}

export async function shareStoryImage(view: View | null): Promise<void> {
  if (Platform.OS === "web") {
    throw new Error(i18n.t("share.storyPhone"));
  }
  if (!view) {
    throw new Error(i18n.t("share.storyUnavailable"));
  }
  const uri = await captureRef(view, { format: "png", quality: 1, result: "tmpfile" });
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error(i18n.t("share.storyUnavailable"));
  }
  await Sharing.shareAsync(uri, {
    mimeType: "image/png",
    UTI: "public.png",
    dialogTitle: i18n.t("share.story"),
  });
}
