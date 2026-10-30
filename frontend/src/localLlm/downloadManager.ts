export type DownloadSink = {
  size(): number;
  append(chunk: Uint8Array): void;
  reset(): void;
};

export type DownloadProgress = {
  loaded: number;
  total: number | null;
};

export class DownloadHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "DownloadHttpError";
    this.status = status;
  }
}

export function createMemorySink(initial?: Uint8Array): DownloadSink & { bytes(): Uint8Array } {
  let buffer = initial ? initial.slice() : new Uint8Array();
  return {
    size: () => buffer.byteLength,
    append(chunk) {
      const next = new Uint8Array(buffer.byteLength + chunk.byteLength);
      next.set(buffer);
      next.set(chunk, buffer.byteLength);
      buffer = next;
    },
    reset() {
      buffer = new Uint8Array();
    },
    bytes: () => buffer,
  };
}

function totalFrom(response: Response, offset: number): number | null {
  const range = response.headers.get("content-range");
  if (range) {
    const match = range.match(/\/(\d+)\s*$/);
    if (match) {
      return Number(match[1]);
    }
  }
  const length = response.headers.get("content-length");
  if (!length) {
    return null;
  }
  const parsed = Number(length);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return response.status === 206 ? offset + parsed : parsed;
}

export async function downloadWithResume(options: {
  url: string;
  sink: DownloadSink;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<{ bytes: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let offset = options.sink.size();
  const headers: Record<string, string> = {};
  if (offset > 0) {
    headers.Range = `bytes=${offset}-`;
  }
  const response = await fetchImpl(options.url, { headers, signal: options.signal });
  if (response.status === 416 && offset > 0) {
    options.onProgress?.({ loaded: offset, total: offset });
    return { bytes: offset };
  }
  if (response.status === 200 && offset > 0) {
    options.sink.reset();
    offset = 0;
  } else if (response.status !== 200 && response.status !== 206) {
    throw new DownloadHttpError(response.status);
  }
  const total = totalFrom(response, offset);
  const reader = response.body?.getReader();
  if (!reader) {
    const chunk = new Uint8Array(await response.arrayBuffer());
    options.sink.append(chunk);
    const loaded = options.sink.size();
    options.onProgress?.({ loaded, total });
    return { bytes: loaded };
  }
  let loaded = offset;
  while (true) {
    const step = await reader.read();
    if (step.done) {
      break;
    }
    options.sink.append(step.value);
    loaded += step.value.byteLength;
    options.onProgress?.({ loaded, total });
  }
  return { bytes: options.sink.size() };
}
