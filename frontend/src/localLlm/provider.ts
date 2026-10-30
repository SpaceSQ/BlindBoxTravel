import { recommendSpots, type DistanceMi, type Origin, type RecommendResponse } from "../api";
import { getAIPriorityScheduler } from "../engines/aiPriorityScheduler";
import { scanMountedModel } from "../utils/ecosystemScanner";
import { CURRENT_APP } from "./constants";
import { chooseCompletionRoute, ON_DEVICE_RUNTIME_LINKED } from "./route";
import type { CompletionRoute, MountedModel } from "./types";

export type MuseCompletion = {
  route: CompletionRoute;
  mountedPath: string | null;
  hostDisplayName: string | null;
  response: RecommendResponse;
};

export interface LocalLLMProvider {
  id: "on-device";
  prepare(): Promise<MountedModel | null>;
  complete(input: { query: string; origin: Origin; maxDistanceMi: DistanceMi }): Promise<MuseCompletion>;
}

async function completeOnCloud(input: { query: string; origin: Origin; maxDistanceMi: DistanceMi }, mounted: MountedModel | null): Promise<MuseCompletion> {
  const route = chooseCompletionRoute({
    mountedPath: mounted?.path ?? null,
    runtimeLinked: ON_DEVICE_RUNTIME_LINKED,
  });
  if (route === "local") {
    throw new Error("on-device runtime is not linked");
  }
  const response = await recommendSpots({
    query: input.query,
    origin: input.origin,
    maxDistanceMi: input.maxDistanceMi,
  });
  return {
    route: "cloud",
    mountedPath: mounted?.path ?? null,
    hostDisplayName: mounted?.hostDisplayName ?? null,
    response,
  };
}

export const localLLMProvider: LocalLLMProvider = {
  id: "on-device",
  prepare: () => scanMountedModel(),
  complete(input) {
    return getAIPriorityScheduler().submit({
      tier: "current",
      appId: CURRENT_APP.id,
      run: async () => {
        let mounted: MountedModel | null = null;
        try {
          mounted = await scanMountedModel();
        } catch {
          mounted = null;
        }
        return completeOnCloud(input, mounted);
      },
    });
  },
};
