/**
 * Structured walkthrough for 11 adult personas.
 * Logic checks always run. UX checks describe the bar the second pass has to clear.
 * Exit 0 only when both pass.
 */
import fs from "node:fs";
import path from "node:path";

import { createAIPriorityScheduler, ExternalSharingDisabledError } from "../src/engines/aiPriorityScheduler";
import { createMemorySink, downloadWithResume } from "../src/localLlm/downloadManager";
import { MIN_READY_BYTES } from "../src/localLlm/constants";
import { chooseCompletionRoute, ON_DEVICE_RUNTIME_LINKED } from "../src/localLlm/route";
import type { ModelCandidate } from "../src/localLlm/types";
import { MUSE_PROMPTS } from "../src/musePrompts";
import { orderedShareActions } from "../src/shareActions";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";
import {
  ECOSYSTEM_KEYWORDS,
  isGreenChannelHost,
  pickMountedModel,
  scanEcosystemModelsFrom,
  shouldStartDownload,
} from "../src/utils/ecosystemScanner";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

type Finding = { id: string; pass: boolean; detail: string };

const findings: Finding[] = [];

function check(id: string, pass: boolean, detail: string) {
  findings.push({ id, pass, detail });
}

function read(relative: string): string {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function candidate(partial: Partial<ModelCandidate> & { hostAppId: string; bytes?: number; status?: "ready" | "partial" }): ModelCandidate {
  const bytes = partial.bytes ?? MIN_READY_BYTES;
  return {
    path: partial.path ?? `file:///models/${partial.hostAppId}.gguf`,
    bytesOnDisk: partial.bytesOnDisk ?? bytes,
    scope: partial.scope ?? "app-group",
    manifest: {
      id: partial.hostAppId,
      fileName: `${partial.hostAppId}.gguf`,
      bytes,
      status: partial.status ?? "ready",
      hostAppId: partial.hostAppId,
      hostDisplayName: partial.manifest?.hostDisplayName ?? partial.hostAppId,
      updatedAt: partial.manifest?.updatedAt ?? "2026-10-30T00:00:00.000Z",
    },
  };
}

const requiredKeywords = [
  "dearearth",
  "dearsage",
  "dearecho",
  "dearhome",
  "dearpet",
  "dearbody",
  "dearmuse",
  "dearalien",
  "ahomeeasy",
  "mhomeeasy",
  "khomeeasy",
  "xhomeeasy",
  "voltpilot",
  "starscope",
  "quoteshield",
  "meshdoctor",
  "powerark",
  "ghostradar",
  "elderguard",
  "hometwin",
  "solartruth",
  "billsniper",
];

check(
  "keywords",
  requiredKeywords.every((word) => ECOSYSTEM_KEYWORDS.includes(word as (typeof ECOSYSTEM_KEYWORDS)[number])) &&
    !ECOSYSTEM_KEYWORDS.includes("mysterygetaway" as (typeof ECOSYSTEM_KEYWORDS)[number]),
  "22 whitepaper keywords present; this app is not pretending to be one of them",
);

check("green-quote", isGreenChannelHost("com.quote.shield"), "QuoteShield package name counts as ecosystem");
check("green-self", isGreenChannelHost("mysterygetaway"), "this app can publish a share source");
check("green-external", !isGreenChannelHost("com.example.notes"), "unknown apps are not green-channel hosts");

const shared = candidate({ hostAppId: "quoteshield", path: "file:///shared/quote.gguf" });
const own = candidate({
  hostAppId: "mysterygetaway",
  path: "file:///own/muse.gguf",
  manifest: {
    id: "mysterygetaway",
    fileName: "mysterygetaway.gguf",
    bytes: MIN_READY_BYTES,
    status: "ready",
    hostAppId: "mysterygetaway",
    hostDisplayName: "Mystery Getaway",
    updatedAt: "2026-10-30T01:00:00.000Z",
  },
});

check(
  "mount-shared",
  scanEcosystemModelsFrom([shared]) === "file:///shared/quote.gguf" && !shouldStartDownload(pickMountedModel([shared])),
  "a valid sibling model is mounted and blocks a new download",
);
check(
  "prefer-own",
  pickMountedModel([shared, own])?.path === "file:///own/muse.gguf",
  "this app's own ready file wins over a sibling",
);
check("ignore-partial", pickMountedModel([candidate({ hostAppId: "dearecho", status: "partial" })]) == null, "partial files are not mounted");
check(
  "ignore-external-file",
  pickMountedModel([candidate({ hostAppId: "com.other.app" })]) == null,
  "a ready file from outside the ecosystem is not auto-mounted",
);
check(
  "ignore-tiny",
  pickMountedModel([candidate({ hostAppId: "voltpilot", bytes: 1024, bytesOnDisk: 1024 })]) == null,
  "files under 8 MB are rejected",
);

async function runLogicChecks(): Promise<void> {
const memory = { allow_external_sharing: null as string | null };
const scheduler = createAIPriorityScheduler({
  get: async (key) => (key === "allow_external_sharing" ? memory.allow_external_sharing : null),
  set: async (key, value) => {
    if (key === "allow_external_sharing") {
      memory.allow_external_sharing = value;
    }
  },
});

const order: string[] = [];
await Promise.all([
  scheduler.submit({
    tier: "ecosystem",
    appId: "quoteshield",
    run: async () => {
      order.push("eco");
    },
  }),
  scheduler.submit({
    tier: "current",
    appId: "mysterygetaway",
    run: async () => {
      order.push("current");
    },
  }),
  scheduler.submit({
    tier: "ecosystem",
    appId: "dearecho",
    run: async () => {
      order.push("eco2");
    },
  }),
]);
check("scheduler-current-first", order.join(",") === "current,eco,eco2", `queue order was ${order.join(",")}`);

let externalBlocked = false;
try {
  await scheduler.submit({ tier: "external", appId: "notes", run: async () => "nope" });
} catch (error) {
  externalBlocked = error instanceof ExternalSharingDisabledError;
}
check("external-default-off", externalBlocked, "external callers are refused until the setting is on");

await scheduler.setExternalAllowed(true);
const allowed = await scheduler.submit({ tier: "external", appId: "notes", run: async () => "yes" });
check("external-when-enabled", allowed === "yes" && (await scheduler.externalAllowed()), "the settings toggle lets an external caller through");

const sink = createMemorySink(new TextEncoder().encode("HEL"));
const seen: string[] = [];
await downloadWithResume({
  url: "https://example.test/model.gguf",
  sink,
  fetchImpl: async (_url, init) => {
    const headers = new Headers(init?.headers);
    seen.push(headers.get("Range") ?? "");
    return new Response("LO", { status: 206, headers: { "content-range": "bytes 3-4/5" } });
  },
});
check("resume-range", seen[0] === "bytes=3-" && new TextDecoder().decode(sink.bytes()) === "HELLO", "resume sends Range and appends");

const restart = createMemorySink(new TextEncoder().encode("OLD"));
await downloadWithResume({
  url: "https://example.test/model.gguf",
  sink: restart,
  fetchImpl: async () => new Response("NEW", { status: 200, headers: { "content-length": "3" } }),
});
check("resume-restart", new TextDecoder().decode(restart.bytes()) === "NEW", "a 200 response replaces a partial file");

check(
  "route-cloud-without-runtime",
  chooseCompletionRoute({ mountedPath: "file:///model.gguf", runtimeLinked: ON_DEVICE_RUNTIME_LINKED }) === "cloud",
  "mounted weights still use cloud until a runtime is linked",
);
check(
  "route-local-when-linked",
  chooseCompletionRoute({ mountedPath: "file:///model.gguf", runtimeLinked: true }) === "local",
  "the provider can switch to local once the runtime exists",
);
check(
  "route-cloud-when-absent",
  chooseCompletionRoute({ mountedPath: null, runtimeLinked: true }) === "cloud",
  "no model means cloud, even if a runtime exists",
);
}

void runLogicChecks().then(() => {
const km = 200 / 1.609344;
const weekend = MUSE_PROMPTS.find((item) => item.id === "weekend");
check(
  "weekend-distance",
  weekend?.distance === 250 && km > 100 && km <= 250,
  "200 km is covered by the 250 mile tier",
);
check(
  "muse-bilingual",
  MUSE_PROMPTS.every((item) => {
    const key = item.promptKey.split(".")[1] as keyof typeof en.muse;
    return Boolean(en.muse[key] && zh.muse[key]);
  }) && MUSE_PROMPTS.length >= 6,
  "every muse chip has English and Chinese copy",
);

check("challenge-omits-place", !en.share.challengeBody.includes("{{place}}") && !zh.share.challengeBody.includes("{{place}}"), "challenge text does not reveal the place");
check("duet-has-link", en.share.duetBody.includes("{{link}}") && en.share.duetBody.includes("{{place}}"), "duet text carries the shared link");

const appJson = read("app.json");
check("app-group", appJson.includes("group.com.robotzero.shared.ai"), "App Group id is in app.json");

const home = read("src/screens/HomeScreen.tsx");
const languageSetting = read("src/components/LanguageSetting.tsx");
const detail = read("src/screens/DetailScreen.tsx");
const shareSheet = read("src/components/TripShareSheet.tsx");
const chips = read("src/components/MuseChips.tsx");
const card = read("src/components/LocalModelCard.tsx");
const zhOrder = orderedShareActions("zh-CN");
const enOrder = orderedShareActions("en-US");

check("wechat-first-zh", zhOrder[0] === "wechat" && zhOrder[1] === "messages" && zhOrder[2] === "save", `zh order starts ${zhOrder.slice(0, 3).join(",")}`);
check("messages-then-save-en", enOrder[0] === "messages" && enOrder[1] === "save", `en order starts ${enOrder.slice(0, 3).join(",")}`);
check("share-groups", shareSheet.includes("share.forFamily") && shareSheet.includes("share.forPlay"), "share sheet splits family send and play");
check("save-card-label", shareSheet.includes("share.saveCard"), "save action uses the print-friendly label");
check(
  "language-on-home",
  home.includes("LanguageSetting") && languageSetting.includes("setAppLanguage"),
  "home can switch language without opening Account",
);
check("chip-hint", home.includes("home.chipHint") && home.includes("home.chipSwipe"), "chips explain tap-again and sideways swipe");
check("second-tap", home.includes("armedId"), "the same chip sends on the second tap");
check("mile-note", home.includes("home.mileNote"), "home explains the mile tier for a 200 km wish");
check("detail-share", detail.includes("TripShareSheet"), "a revealed plan can be shared from the detail screen");
check("muse-context", detail.includes("peekMuseContext"), "family and 48-hour chips change the plan form defaults");
check("chip-target", chips.includes("minHeight: 48"), "suggestion chips meet a 48pt target");
const privacyAt = card.indexOf('t("localLlm.privacy")');
const downloadAt = card.indexOf('t("localLlm.download")');
check("privacy-before-download", privacyAt !== -1 && downloadAt !== -1 && privacyAt < downloadAt, "privacy copy is visible before the download button");
check("runtime-copy", en.localLlm.runtimeGap.length < 140 && zh.localLlm.runtimeGap.length < 80, "runtime gap copy stays short");
check("duet-plain", !en.share.action.duet.toLowerCase().includes("duet"), "the duet action is named in plain language");

const personas = [
  {
    id: "shenzhen-19",
    name: "19 · Shenzhen university student",
    goals: "A cheap weekend that still feels like a plot, then send it to a group chat.",
    taps: "Weekend chip, 250 mi tier, explore, later WeChat.",
    confuses: "The app opens in English and miles. 200 km does not match the mile chips until the note is on screen.",
    checks: ["language-on-home", "mile-note", "wechat-first-zh"],
  },
  {
    id: "shanghai-28",
    name: "28 · Shanghai product manager",
    goals: "Fill a prompt, edit one word, then go. No surprise navigation.",
    taps: "Food chip, edits the sentence, Start exploring.",
    confuses: "A chip that immediately searches feels like the product decided for her. A second tap is the shortcut.",
    checks: ["second-tap", "chip-hint"],
  },
  {
    id: "austin-35",
    name: "35 · Austin remote engineer",
    goals: "Know whether the local model uploads weights, and whether answers are actually on-device.",
    taps: "Account → on-device model card, reads privacy, leaves the external toggle off.",
    confuses: "A long runtime paragraph under the download button is easy to miss, and sounds like a status log.",
    checks: ["privacy-before-download", "runtime-copy"],
  },
  {
    id: "guangzhou-42",
    name: "42 · Guangzhou parent",
    goals: "A trip for kids and grandparents, then a card the family WeChat can open.",
    taps: "Family chip, unlock form, share.",
    confuses: "The chip does not change the traveler count. Share lives on another tab, and WeChat is not the first button.",
    checks: ["muse-context", "detail-share", "wechat-first-zh", "save-card-label", "share-groups"],
  },
  {
    id: "beijing-55",
    name: "55 · Beijing empty-nester",
    goals: "One obvious sentence, large targets, a picture they can save and show.",
    taps: "First chip they can read, save card.",
    confuses: "Horizontal chips hide the rest of the ideas. English jargon and equal-weight share buttons look like a toolbox.",
    checks: ["chip-target", "chip-hint", "language-on-home", "share-groups", "save-card-label"],
  },
  {
    id: "toronto-23",
    name: "23 · Toronto exchange student",
    goals: "Switch to English, plan 48 hours, send a challenge to classmates.",
    taps: "Language, 48-hour chip, challenge.",
    confuses: "Language lives only in Account. Challenge is buried in the same row as X and Facebook.",
    checks: ["language-on-home", "share-groups", "second-tap"],
  },
  {
    id: "tokyo-31",
    name: "31 · Tokyo salaryman",
    goals: "48 hours, no plan, one night of photos, then back.",
    taps: "48-hour chip twice, photo chip as an edit.",
    confuses: "One tap only fills the box, so the second step is unclear. Days stay at 1 on the unlock form.",
    checks: ["second-tap", "chip-hint", "muse-context"],
  },
  {
    id: "la-27",
    name: "27 · Los Angeles creator",
    goals: "A sticker for Stories, a remix prompt, a sequel a friend can join.",
    taps: "Story sticker template, remix, sequel action.",
    confuses: "Duet is insider language. Play actions sit in the same grid as Messages.",
    checks: ["duet-plain", "share-groups"],
  },
  {
    id: "chengdu-48",
    name: "48 · Chengdu foodie couple",
    goals: "Eat the local specialty and send a printable card to relatives.",
    taps: "Food chip, postcard, save.",
    confuses: "Save is labeled like a QR utility. Relatives need WeChat or a picture, not X.",
    checks: ["save-card-label", "wechat-first-zh", "share-groups"],
  },
  {
    id: "singapore-36",
    name: "36 · Singapore teacher",
    goals: "A clear rainy-day plan she can explain to another adult.",
    taps: "Rainy chip, classic card, Messages.",
    confuses: "Miles without a note, and a share sheet that starts with a social network she does not use.",
    checks: ["mile-note", "messages-then-save-en"],
  },
  {
    id: "seoul-22",
    name: "22 · Seoul design student",
    goals: "Night photos, a dark sticker, and a short link a friend can remix.",
    taps: "Photo chip, story sticker, remix prompt.",
    confuses: "The sticker exists, but it is visually equal to every other action, so the play path does not stand out.",
    checks: ["share-groups", "chip-target"],
  },
];

check("persona-count", personas.length >= 10, `${personas.length} personas`);

const failed = findings.filter((item) => !item.pass);
const report = {
  personas: personas.map((persona) => ({
    ...persona,
    open: persona.checks.filter((id) => findings.find((item) => item.id === id && !item.pass)),
  })),
  findings,
  failed: failed.map((item) => item.id),
};

console.log(JSON.stringify(report, null, 2));
if (failed.length > 0) {
  process.exitCode = 1;
}
});
