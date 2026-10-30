export const APP_GROUP_ID = "group.com.robotzero.shared.ai";
export const ALLOW_EXTERNAL_SHARING_KEY = "allow_external_sharing";
export const PAUSE_STATE_KEY = "mysterygetaway.localLlm.pauseState";
export const MIN_READY_BYTES = 8 * 1024 * 1024;

export const CURRENT_APP = {
  id: "mysterygetaway",
  displayName: "Mystery Getaway",
  bundleId: "com.blindboxtravel.app",
} as const;

export const RECOMMENDED_MODEL = {
  id: "smollm2-135m-instruct-q4",
  fileName: "smollm2-135m-instruct-q4_k_m.gguf",
  approximateMegabytes: 100,
  displayName: "SmolLM2 135M Instruct",
} as const;

export const DEFAULT_MODEL_URL =
  "https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct-GGUF/resolve/main/smollm2-135m-instruct-q4_k_m.gguf";

export function recommendedModelUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_LOCAL_MODEL_URL?.trim();
  return fromEnv || DEFAULT_MODEL_URL;
}
