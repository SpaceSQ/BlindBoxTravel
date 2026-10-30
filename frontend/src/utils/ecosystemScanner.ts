import { CURRENT_APP, MIN_READY_BYTES } from "../localLlm/constants";
import type { ModelCandidate, MountedModel } from "../localLlm/types";

/** Keywords from the RobotZero / 智家 22-app whitepaper. This app is matched separately. */
export const ECOSYSTEM_KEYWORDS = [
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
] as const;

export function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function matchEcosystemKeyword(value: string): string | null {
  const folded = normalizeToken(value);
  if (!folded) {
    return null;
  }
  return ECOSYSTEM_KEYWORDS.find((keyword) => folded.includes(keyword)) ?? null;
}

export function isGreenChannelHost(hostAppId: string): boolean {
  if (normalizeToken(hostAppId) === CURRENT_APP.id) {
    return true;
  }
  return matchEcosystemKeyword(hostAppId) != null;
}

function isMountable(entry: ModelCandidate): boolean {
  const manifest = entry.manifest;
  if (manifest.status !== "ready") {
    return false;
  }
  if (!Number.isFinite(manifest.bytes) || manifest.bytes < MIN_READY_BYTES) {
    return false;
  }
  if (entry.bytesOnDisk !== manifest.bytes) {
    return false;
  }
  return isGreenChannelHost(manifest.hostAppId);
}

function newest(entries: ModelCandidate[]): ModelCandidate | null {
  if (entries.length === 0) {
    return null;
  }
  return [...entries].sort((a, b) => b.manifest.updatedAt.localeCompare(a.manifest.updatedAt))[0];
}

export function pickMountedModel(entries: ModelCandidate[]): MountedModel | null {
  const ready = entries.filter(isMountable);
  const own = ready.filter((entry) => normalizeToken(entry.manifest.hostAppId) === CURRENT_APP.id);
  const shared = ready.filter((entry) => matchEcosystemKeyword(entry.manifest.hostAppId));
  const chosen = newest(own) ?? newest(shared);
  if (!chosen) {
    return null;
  }
  return {
    path: chosen.path,
    hostAppId: chosen.manifest.hostAppId,
    hostDisplayName: chosen.manifest.hostDisplayName,
    sharedFromEcosystem: normalizeToken(chosen.manifest.hostAppId) !== CURRENT_APP.id,
    scope: chosen.scope,
  };
}

export function scanEcosystemModelsFrom(entries: ModelCandidate[]): string | null {
  return pickMountedModel(entries)?.path ?? null;
}

export function shouldStartDownload(mounted: MountedModel | null): boolean {
  return mounted == null;
}

async function defaultReadIndex(): Promise<ModelCandidate[]> {
  const store = await import("../localLlm/modelStore");
  return store.readModelCandidates();
}

export async function scanMountedModel(readIndex?: () => Promise<ModelCandidate[]>): Promise<MountedModel | null> {
  const read = readIndex ?? defaultReadIndex;
  return pickMountedModel(await read());
}

export async function scanEcosystemModels(readIndex?: () => Promise<ModelCandidate[]>): Promise<string | null> {
  const mounted = await scanMountedModel(readIndex);
  return mounted?.path ?? null;
}
