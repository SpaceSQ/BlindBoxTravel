export type ModelStatus = "ready" | "partial";

export type StorageScope = "app-group" | "sandbox";

export type ModelManifest = {
  id: string;
  fileName: string;
  bytes: number;
  status: ModelStatus;
  hostAppId: string;
  hostDisplayName: string;
  updatedAt: string;
};

export type ModelCandidate = {
  manifest: ModelManifest;
  bytesOnDisk: number;
  path: string;
  scope: StorageScope;
};

export type MountedModel = {
  path: string;
  hostAppId: string;
  hostDisplayName: string;
  sharedFromEcosystem: boolean;
  scope: StorageScope;
};

export type LocalModelPhase = "scanning" | "absent" | "downloading" | "paused" | "ready" | "error";

export type LocalModelErrorCode = "http" | "small" | "network" | "unavailable" | null;

export type LocalModelSnapshot = {
  phase: LocalModelPhase;
  hostAppId: string | null;
  hostDisplayName: string | null;
  shared: boolean;
  scope: StorageScope | null;
  progress: number | null;
  externalAllowed: boolean;
  inferenceAvailable: boolean;
  errorCode: LocalModelErrorCode;
};

export type CompletionRoute = "local" | "cloud";
