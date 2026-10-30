export const SHARE_ACTION_IDS = [
  "messages",
  "wechat",
  "whatsapp",
  "save",
  "system",
  "story",
  "challenge",
  "reveal",
  "remix",
  "duet",
  "x",
  "facebook",
] as const;

export type ShareActionId = (typeof SHARE_ACTION_IDS)[number];

export type PosterTemplate = "classic" | "postcard" | "sticker";

export const POSTER_TEMPLATES: PosterTemplate[] = ["classic", "postcard", "sticker"];

const ZH_ORDER: ShareActionId[] = [
  "wechat",
  "messages",
  "save",
  "system",
  "whatsapp",
  "story",
  "reveal",
  "challenge",
  "remix",
  "duet",
  "x",
  "facebook",
];

const EN_ORDER: ShareActionId[] = [
  "messages",
  "save",
  "whatsapp",
  "system",
  "story",
  "wechat",
  "challenge",
  "reveal",
  "remix",
  "duet",
  "x",
  "facebook",
];

export function orderedShareActions(language = "en-US"): ShareActionId[] {
  return language.toLowerCase().startsWith("zh") ? ZH_ORDER : EN_ORDER;
}

export function familyShareActions(language?: string): ShareActionId[] {
  const family = new Set<ShareActionId>(["messages", "wechat", "whatsapp", "save", "system"]);
  return orderedShareActions(language).filter((id) => family.has(id));
}

export function playShareActions(language?: string): ShareActionId[] {
  const play = new Set<ShareActionId>(["story", "challenge", "reveal", "remix", "duet", "x", "facebook"]);
  return orderedShareActions(language).filter((id) => play.has(id));
}

export function fillShareText(template: string, vars: { place?: string; link?: string }): string {
  return template.replaceAll("{{place}}", vars.place ?? "").replaceAll("{{link}}", vars.link ?? "");
}

export function messagesUrl(body: string, platform: string): string {
  const encoded = encodeURIComponent(body);
  return platform === "android" ? `sms:?body=${encoded}` : `sms:&body=${encoded}`;
}

export function whatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function weChatUrl(): string {
  return "weixin://";
}
