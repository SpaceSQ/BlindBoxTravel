import type { CompletionRoute } from "./types";

/**
 * The on-device runtime (llama.cpp / MLX) is not linked in this build.
 * A mounted weight file is still recorded so the green channel can share it,
 * but answers fall back to the existing server-side cloud model.
 */
export const ON_DEVICE_RUNTIME_LINKED = false;

export function chooseCompletionRoute(input: { mountedPath: string | null; runtimeLinked: boolean }): CompletionRoute {
  if (input.mountedPath && input.runtimeLinked) {
    return "local";
  }
  return "cloud";
}
