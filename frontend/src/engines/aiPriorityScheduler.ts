import { ALLOW_EXTERNAL_SHARING_KEY } from "../localLlm/constants";

export type PriorityTier = "current" | "ecosystem" | "external";

export type FlagStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

export type PriorityRequest<T> = {
  tier: PriorityTier;
  appId: string;
  run: () => Promise<T>;
};

type Job = {
  tier: PriorityTier;
  appId: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export class ExternalSharingDisabledError extends Error {
  constructor() {
    super("external sharing is off");
    this.name = "ExternalSharingDisabledError";
  }
}

export class AIPriorityScheduler {
  private queue: Job[] = [];
  private draining = false;
  private scheduled = false;

  constructor(private readonly store: FlagStore) {}

  async externalAllowed(): Promise<boolean> {
    const value = await this.store.get(ALLOW_EXTERNAL_SHARING_KEY);
    return value === "true";
  }

  async setExternalAllowed(allowed: boolean): Promise<void> {
    await this.store.set(ALLOW_EXTERNAL_SHARING_KEY, allowed ? "true" : "false");
  }

  submit<T>(request: PriorityRequest<T>): Promise<T> {
    if (request.tier === "external") {
      return this.externalAllowed().then((allowed) => {
        if (!allowed) {
          throw new ExternalSharingDisabledError();
        }
        return this.enqueue(request);
      });
    }
    return this.enqueue(request);
  }

  private enqueue<T>(request: PriorityRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        tier: request.tier,
        appId: request.appId,
        run: request.run,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  private takeNext(): Job | undefined {
    const currentIndex = this.queue.findIndex((job) => job.tier === "current");
    const index = currentIndex >= 0 ? currentIndex : 0;
    return this.queue.splice(index, 1)[0];
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.takeNext();
        if (!job) {
          break;
        }
        try {
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) {
        this.schedule();
      }
    }
  }
}

export function createAIPriorityScheduler(store: FlagStore): AIPriorityScheduler {
  return new AIPriorityScheduler(store);
}

const asyncStorageFlags: FlagStore = {
  async get(key) {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    return AsyncStorage.getItem(key);
  },
  async set(key, value) {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    await AsyncStorage.setItem(key, value);
  },
};

let singleton: AIPriorityScheduler | null = null;

export function getAIPriorityScheduler(): AIPriorityScheduler {
  if (!singleton) {
    singleton = createAIPriorityScheduler(asyncStorageFlags);
  }
  return singleton;
}
