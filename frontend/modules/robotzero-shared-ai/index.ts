import { requireNativeModule } from "expo-modules-core";

type NativeContainer = {
  containerUri(): string | null;
  containerIsShared(): boolean;
};

export type SharedContainer = {
  uri: string;
  shared: boolean;
};

export function readNativeContainer(): SharedContainer | null {
  try {
    const native = requireNativeModule<NativeContainer>("RobotZeroSharedAI");
    const uri = native.containerUri();
    if (!uri) {
      return null;
    }
    return { uri, shared: native.containerIsShared() };
  } catch {
    return null;
  }
}
