import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DownloadPauseState } from "expo-file-system";

import { getAIPriorityScheduler } from "../engines/aiPriorityScheduler";
import { pickMountedModel } from "../utils/ecosystemScanner";
import { MIN_READY_BYTES, PAUSE_STATE_KEY } from "./constants";
import {
  discardRecommendedWeights,
  downloadRecommended,
  pauseActiveDownload,
  publishReadyManifest,
  readModelCandidates,
  releaseDownload,
  weightsAvailable,
} from "./modelStore";
import { ON_DEVICE_RUNTIME_LINKED } from "./route";
import type { LocalModelErrorCode, LocalModelSnapshot } from "./types";

const initialSnapshot = (): LocalModelSnapshot => ({
  phase: "scanning",
  hostAppId: null,
  hostDisplayName: null,
  shared: false,
  scope: null,
  progress: null,
  externalAllowed: false,
  inferenceAvailable: ON_DEVICE_RUNTIME_LINKED,
  errorCode: null,
});

function errorCodeOf(error: unknown): LocalModelErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (code === "http" || code === "small" || code === "network" || code === "unavailable") {
      return code;
    }
  }
  return "network";
}

export class LocalModelController {
  snapshot: LocalModelSnapshot = initialSnapshot();
  private listeners = new Set<(snapshot: LocalModelSnapshot) => void>();
  private probing: Promise<void> | null = null;
  private downloading = false;

  subscribe(listener: (snapshot: LocalModelSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(patch: Partial<LocalModelSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  probe(): Promise<void> {
    if (this.snapshot.phase === "downloading" || this.snapshot.phase === "paused") {
      return Promise.resolve();
    }
    if (this.probing) {
      return this.probing;
    }
    this.probing = this.doProbe().finally(() => {
      this.probing = null;
    });
    return this.probing;
  }

  private async doProbe(): Promise<void> {
    this.update({ phase: "scanning", errorCode: null });
    const externalAllowed = await getAIPriorityScheduler().externalAllowed();
    if (!weightsAvailable()) {
      this.update({
        phase: "absent",
        shared: false,
        scope: null,
        hostAppId: null,
        hostDisplayName: null,
        progress: null,
        externalAllowed,
      });
      return;
    }
    try {
      const mounted = pickMountedModel(await readModelCandidates());
      if (!mounted) {
        const saved = await AsyncStorage.getItem(PAUSE_STATE_KEY);
        this.update({
          phase: saved ? "paused" : "absent",
          shared: false,
          scope: null,
          hostAppId: null,
          hostDisplayName: null,
          progress: null,
          externalAllowed,
        });
        return;
      }
      this.update({
        phase: "ready",
        hostAppId: mounted.hostAppId,
        hostDisplayName: mounted.hostDisplayName,
        shared: mounted.sharedFromEcosystem,
        scope: mounted.scope,
        progress: 1,
        externalAllowed,
        errorCode: null,
      });
    } catch {
      this.update({ phase: "error", errorCode: "unavailable", externalAllowed });
    }
  }

  async setExternalAllowed(allowed: boolean): Promise<void> {
    await getAIPriorityScheduler().setExternalAllowed(allowed);
    this.update({ externalAllowed: allowed });
  }

  async startDownload(): Promise<void> {
    if (this.downloading || this.snapshot.phase === "ready") {
      return;
    }
    if (!weightsAvailable()) {
      this.update({ phase: "absent", errorCode: null });
      return;
    }
    const mounted = pickMountedModel(await readModelCandidates());
    if (mounted) {
      this.update({
        phase: "ready",
        hostAppId: mounted.hostAppId,
        hostDisplayName: mounted.hostDisplayName,
        shared: mounted.sharedFromEcosystem,
        scope: mounted.scope,
        progress: 1,
        errorCode: null,
      });
      return;
    }
    this.downloading = true;
    this.update({ phase: "downloading", progress: 0, errorCode: null, shared: false });
    try {
      const savedRaw = await AsyncStorage.getItem(PAUSE_STATE_KEY);
      let pauseState: DownloadPauseState | null = null;
      if (savedRaw) {
        try {
          pauseState = JSON.parse(savedRaw) as DownloadPauseState;
        } catch {
          pauseState = null;
        }
      }
      const result = await downloadRecommended({
        pauseState,
        onProgress: (loaded, total) => {
          this.update({ progress: total && total > 0 ? loaded / total : null });
        },
      });
      if (result.paused && result.pauseState) {
        await AsyncStorage.setItem(PAUSE_STATE_KEY, JSON.stringify(result.pauseState));
        this.update({ phase: "paused", progress: this.snapshot.progress });
        return;
      }
      if (result.bytes < MIN_READY_BYTES) {
        await discardRecommendedWeights();
        await AsyncStorage.removeItem(PAUSE_STATE_KEY);
        this.update({ phase: "error", errorCode: "small", progress: null });
        return;
      }
      const published = await publishReadyManifest(result.bytes);
      await AsyncStorage.removeItem(PAUSE_STATE_KEY);
      if (!published) {
        this.update({ phase: "error", errorCode: "small", progress: null });
        return;
      }
      this.update({
        phase: "ready",
        hostAppId: published.manifest.hostAppId,
        hostDisplayName: published.manifest.hostDisplayName,
        shared: false,
        scope: published.scope,
        progress: 1,
        errorCode: null,
      });
    } catch (error) {
      this.update({ phase: "error", errorCode: errorCodeOf(error), progress: null });
    } finally {
      this.downloading = false;
      releaseDownload();
    }
  }

  async pause(): Promise<void> {
    const state = await pauseActiveDownload();
    if (!state) {
      return;
    }
    await AsyncStorage.setItem(PAUSE_STATE_KEY, JSON.stringify(state));
    this.downloading = false;
    this.update({ phase: "paused" });
  }

  async resume(): Promise<void> {
    await this.startDownload();
  }
}

let controller: LocalModelController | null = null;

export function getLocalModelController(): LocalModelController {
  if (!controller) {
    controller = new LocalModelController();
  }
  return controller;
}
