import { Platform } from "react-native";
import { Directory, DownloadTask, File, Paths, type DownloadPauseState } from "expo-file-system";

import { readNativeContainer } from "robotzero-shared-ai";

import { APP_GROUP_ID, CURRENT_APP, MIN_READY_BYTES, RECOMMENDED_MODEL, recommendedModelUrl } from "./constants";
import { downloadWithResume, type DownloadSink } from "./downloadManager";
import type { ModelCandidate, ModelManifest, StorageScope } from "./types";

const SAFE_FILE = /^[\w.-]+$/;

let activeTask: DownloadTask | null = null;

export function weightsAvailable(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

async function locateModels(): Promise<{ directory: Directory; scope: StorageScope } | null> {
  if (!weightsAvailable()) {
    return null;
  }
  try {
    const native = readNativeContainer();
    if (native?.uri) {
      const directory = new Directory(native.uri);
      if (!directory.exists) {
        directory.create({ intermediates: true });
      }
      return { directory, scope: native.shared ? "app-group" : "sandbox" };
    }
    const directory = new Directory(Paths.document, APP_GROUP_ID, "models");
    if (!directory.exists) {
      directory.create({ intermediates: true });
    }
    return { directory, scope: "sandbox" };
  } catch {
    return null;
  }
}

function asManifest(value: unknown): ModelManifest | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<ModelManifest>;
  if (record.status !== "ready" && record.status !== "partial") {
    return null;
  }
  if (typeof record.id !== "string" || typeof record.fileName !== "string" || typeof record.hostAppId !== "string") {
    return null;
  }
  if (typeof record.hostDisplayName !== "string" || typeof record.updatedAt !== "string") {
    return null;
  }
  if (typeof record.bytes !== "number" || !SAFE_FILE.test(record.fileName)) {
    return null;
  }
  return {
    id: record.id,
    fileName: record.fileName,
    bytes: record.bytes,
    status: record.status,
    hostAppId: record.hostAppId,
    hostDisplayName: record.hostDisplayName,
    updatedAt: record.updatedAt,
  };
}

export async function readModelCandidates(): Promise<ModelCandidate[]> {
  const located = await locateModels();
  if (!located) {
    return [];
  }
  const candidates: ModelCandidate[] = [];
  for (const item of located.directory.list()) {
    if (!(item instanceof File) || !item.name.endsWith(".manifest.json")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await item.text());
    } catch {
      continue;
    }
    const manifest = asManifest(parsed);
    if (!manifest) {
      continue;
    }
    const weights = new File(located.directory, manifest.fileName);
    candidates.push({
      manifest,
      bytesOnDisk: weights.exists ? weights.size : 0,
      path: weights.uri,
      scope: located.scope,
    });
  }
  return candidates;
}

function manifestFile(directory: Directory): File {
  return new File(directory, `${RECOMMENDED_MODEL.id}.manifest.json`);
}

function weightsFile(directory: Directory): File {
  return new File(directory, RECOMMENDED_MODEL.fileName);
}

async function writeManifest(directory: Directory, manifest: ModelManifest): Promise<void> {
  const file = manifestFile(directory);
  if (file.exists) {
    file.delete();
  }
  file.write(JSON.stringify(manifest));
}

export async function publishReadyManifest(bytes: number): Promise<ModelCandidate | null> {
  const located = await locateModels();
  if (!located) {
    return null;
  }
  const weights = weightsFile(located.directory);
  if (!weights.exists || weights.size !== bytes || bytes < MIN_READY_BYTES) {
    return null;
  }
  const manifest: ModelManifest = {
    id: RECOMMENDED_MODEL.id,
    fileName: RECOMMENDED_MODEL.fileName,
    bytes,
    status: "ready",
    hostAppId: CURRENT_APP.id,
    hostDisplayName: CURRENT_APP.displayName,
    updatedAt: new Date().toISOString(),
  };
  await writeManifest(located.directory, manifest);
  return { manifest, bytesOnDisk: bytes, path: weights.uri, scope: located.scope };
}

async function fileSink(file: File): Promise<DownloadSink> {
  return {
    size: () => (file.exists ? file.size : 0),
    append(chunk) {
      if (!file.exists || file.size === 0) {
        file.write(chunk);
        return;
      }
      file.write(chunk, { append: true });
    },
    reset() {
      if (file.exists) {
        file.delete();
      }
    },
  };
}

export async function downloadRecommended(options: {
  onProgress: (loaded: number, total: number | null) => void;
  pauseState?: DownloadPauseState | null;
}): Promise<{ bytes: number; pauseState: DownloadPauseState | null; paused: boolean }> {
  const located = await locateModels();
  if (!located) {
    throw Object.assign(new Error("unavailable"), { code: "unavailable" });
  }
  const destination = weightsFile(located.directory);
  const onProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
    options.onProgress(bytesWritten, totalBytes > 0 ? totalBytes : null);
  };
  try {
    if (options.pauseState && options.pauseState.fileUri === destination.uri) {
      activeTask = DownloadTask.fromSavable(options.pauseState, { onProgress });
      const file = await activeTask.resumeAsync();
      if (!file) {
        return { bytes: destination.exists ? destination.size : 0, pauseState: activeTask.savable(), paused: true };
      }
      return { bytes: file.size, pauseState: null, paused: false };
    }
    if (destination.exists && destination.size > 0) {
      const sink = await fileSink(destination);
      const result = await downloadWithResume({
        url: recommendedModelUrl(),
        sink,
        onProgress: ({ loaded, total }) => options.onProgress(loaded, total),
      });
      return { bytes: result.bytes, pauseState: null, paused: false };
    }
    if (destination.exists) {
      destination.delete();
    }
    activeTask = File.createDownloadTask(recommendedModelUrl(), destination, { onProgress });
    const file = await activeTask.downloadAsync();
    if (!file) {
      return { bytes: destination.exists ? destination.size : 0, pauseState: activeTask.savable(), paused: true };
    }
    return { bytes: file.size, pauseState: null, paused: false };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }
    const fallback = await fileSink(destination);
    try {
      const result = await downloadWithResume({
        url: recommendedModelUrl(),
        sink: fallback,
        onProgress: ({ loaded, total }) => options.onProgress(loaded, total),
      });
      return { bytes: result.bytes, pauseState: null, paused: false };
    } catch (inner) {
      const status = inner && typeof inner === "object" && "status" in inner ? Number(inner.status) : 0;
      if (status > 0) {
        throw Object.assign(new Error("http"), { code: "http" });
      }
      throw Object.assign(new Error("network"), { code: "network" });
    }
  }
}

export async function pauseActiveDownload(): Promise<DownloadPauseState | null> {
  if (!activeTask || activeTask.state !== "active") {
    return null;
  }
  await activeTask.pauseAsync();
  return activeTask.savable();
}

export function releaseDownload(): void {
  activeTask?.release();
  activeTask = null;
}

export async function discardRecommendedWeights(): Promise<void> {
  const located = await locateModels();
  if (!located) {
    return;
  }
  const weights = weightsFile(located.directory);
  if (weights.exists) {
    weights.delete();
  }
  const manifest = manifestFile(located.directory);
  if (manifest.exists) {
    manifest.delete();
  }
}
