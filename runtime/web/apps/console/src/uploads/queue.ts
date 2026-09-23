import { ApiError, isSessionLost, type SessionLoss } from "../api/client";
import { addSample, type Sample } from "./eta";
import { baseName, joinPath, parentOf } from "./paths";
import type { PendingUpload, UploadApi } from "./uploadApi";

export const RESERVE = 1024 ** 3;
export const DEFAULT_CHUNK = 8 * 1024 * 1024;
const BUSY_RETRY_MS = 3000;
const NETWORK_RETRIES = 3;

export type UploadState = "waiting" | "going" | "paused" | "stalled" | "noRoom" | "failed" | "done";

export interface UploadItem {
  key: string;
  projectId: string;
  dir: string;
  name: string;
  size: number;
  fingerprint: string;
  file: File | null;
  uploadId: string | null;
  offset: number;
  chunkSize: number;
  replace: boolean;
  state: UploadState;
  reason: string | null;
  message: string | null;
  busy: boolean;
  // A finishing PATCH (chunk ending at size, including the empty busy-retry
  // one) can finish on the API unanswered; a 404 after it means it landed.
  finishing: boolean;
  fromReload: boolean;
  freeBytes: number | null;
  samples: readonly Sample[];
}

export function fingerprintOf(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function fits(size: number, freeBytes: number): boolean {
  return size + RESERVE <= freeBytes;
}

function numberOr<T>(value: unknown, fallback: T): number | T {
  return typeof value === "number" ? value : fallback;
}

export interface QueueOptions {
  api: UploadApi;
  onLanded?: (item: UploadItem) => void;
  onSessionLost?: (reason: SessionLoss) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class UploadQueue {
  private items: readonly UploadItem[] = [];
  private readonly listeners = new Set<() => void>();
  private active: { key: string; controller: AbortController } | null = null;
  private running = false;
  private disposed = false;
  private runPromise: Promise<void> | null = null;
  private counter = 0;
  private readonly api: UploadApi;
  private readonly onLanded: (item: UploadItem) => void;
  private readonly onSessionLost: (reason: SessionLoss) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: QueueOptions) {
    this.api = options.api;
    this.onLanded = options.onLanded ?? (() => {});
    this.onSessionLost = options.onSessionLost ?? (() => {});
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = (): readonly UploadItem[] => this.items;

  settled(): Promise<void> {
    return this.runPromise ?? Promise.resolve();
  }

  add(projectId: string, dir: string, files: readonly File[]): string[] {
    const added: UploadItem[] = files.map((f) => ({
      key: `u${++this.counter}`,
      projectId,
      dir,
      name: f.name,
      size: f.size,
      fingerprint: fingerprintOf(f),
      file: f,
      uploadId: null,
      offset: 0,
      chunkSize: DEFAULT_CHUNK,
      replace: false,
      state: "waiting",
      reason: null,
      message: null,
      busy: false,
      finishing: false,
      fromReload: false,
      freeBytes: null,
      samples: [],
    }));
    this.items = [...this.items, ...added];
    this.emit();
    this.kick();
    return added.map((i) => i.key);
  }

  pause(key: string): void {
    if (this.find(key)?.state !== "going") return;
    this.update(key, { state: "paused", busy: false });
    this.abort(key);
  }

  resume(key: string): void {
    const item = this.find(key);
    if (!item) return;
    const resumable = item.state === "paused" || (item.state === "stalled" && item.file !== null);
    if (!resumable) return;
    this.update(key, { state: "waiting" });
    this.kick();
  }

  remove(key: string): void {
    const item = this.find(key);
    if (!item) return;
    this.abort(key);
    this.items = this.items.filter((i) => i.key !== key);
    this.emit();
    // A failed cancel is left for the API's seven-day sweep.
    if (item.uploadId !== null && item.state !== "done") void this.api.cancel(item.uploadId).catch(() => {});
    this.kick();
  }

  replace(key: string): void {
    const item = this.find(key);
    if (item?.state !== "failed" || item.reason !== "file_exists") return;
    this.update(key, { replace: true, state: "waiting", reason: null, message: null });
    this.kick();
  }

  relink(key: string, file: File): boolean {
    const item = this.find(key);
    if (!item || (item.state !== "stalled" && item.state !== "paused")) return false;
    if (fingerprintOf(file) !== item.fingerprint) return false;
    this.update(key, { file, state: "waiting" });
    this.kick();
    return true;
  }

  adoptPending(projectId: string, uploads: readonly PendingUpload[]): void {
    const held = new Set(this.items.map((i) => i.uploadId));
    // An upload whose start is still in flight has no id here yet, but the API already lists it.
    const starting = new Set(
      this.items.filter((i) => i.state === "going" && i.uploadId === null).map((i) => `${joinPath(i.dir, i.name)}\0${i.fingerprint}`),
    );
    const found: UploadItem[] = uploads
      .filter((u) => !held.has(u.id) && !starting.has(`${u.path}\0${u.fingerprint}`))
      .map((u) => ({
        key: u.id,
        projectId,
        dir: parentOf(u.path),
        name: baseName(u.path),
        size: u.size,
        fingerprint: u.fingerprint,
        file: null,
        uploadId: u.id,
        offset: u.offset,
        chunkSize: DEFAULT_CHUNK,
        replace: u.replace,
        state: "stalled",
        reason: null,
        message: null,
        busy: false,
        finishing: false,
        fromReload: true,
        freeBytes: null,
        samples: [],
      }));
    if (found.length === 0) return;
    this.items = [...this.items, ...found];
    this.emit();
  }

  async syncPending(projectId: string): Promise<void> {
    try {
      const { uploads } = await this.api.pending(projectId);
      this.adoptPending(projectId, uploads);
    } catch (error) {
      if (isSessionLost(error)) this.lost(error.code);
    }
  }

  async carryOn(): Promise<boolean> {
    let free: number;
    try {
      ({ free_bytes: free } = await this.api.disk());
    } catch (error) {
      if (!isSessionLost(error)) throw error;
      this.lost(error.code);
      return false;
    }
    let moved = false;
    for (const item of this.items) {
      if (item.state !== "noRoom") continue;
      // Staged bytes are already on disk; only a fresh start needs the reserve.
      const room = item.uploadId !== null ? item.size - item.offset <= free : fits(item.size, free);
      if (room) {
        this.update(item.key, { state: "waiting", freeBytes: null });
        moved = true;
      } else {
        this.update(item.key, { freeBytes: free });
      }
    }
    this.kick();
    return moved;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  // Aborts the chunk in flight; a start or status already sent is left to finish unheard.
  dispose(): void {
    this.disposed = true;
    this.active?.controller.abort();
  }

  private abort(key: string): void {
    if (this.active?.key === key) this.active.controller.abort();
  }

  // A disk_full item already holds staged bytes; nothing else may start until
  // space is freed, or it would hit the same wall.
  private get held(): boolean {
    return this.items.some((i) => i.state === "noRoom" && i.uploadId !== null);
  }

  private kick(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.runPromise = this.run();
  }

  private async run(): Promise<void> {
    // `running` is cleared in the same synchronous step that finds no work,
    // so an add() arriving right after can never be missed.
    try {
      for (;;) {
        if (this.disposed || this.held) return;
        const next = this.items.find((i) => i.state === "waiting");
        if (!next) return;
        await this.send(next.key);
      }
    } finally {
      this.running = false;
    }
  }

  private async send(key: string): Promise<void> {
    const controller = new AbortController();
    this.active = { key, controller };
    this.update(key, { state: "going", reason: null, message: null, busy: false, samples: [] });
    let needSync = this.find(key)?.uploadId != null;
    let restarted = false;
    let failures = 0;
    try {
      for (;;) {
        const item = this.find(key);
        if (this.disposed || !item || item.state !== "going") return;
        try {
          if (item.uploadId === null) {
            const answer = await this.api.start(item.projectId, {
              path: joinPath(item.dir, item.name),
              size: item.size,
              fingerprint: item.fingerprint,
              replace: item.replace,
            });
            failures = 0;
            if (!this.find(key)) {
              if (!answer.done) void this.api.cancel(answer.upload_id).catch(() => {});
              return;
            }
            if (answer.done) {
              this.land(key);
              return;
            }
            this.update(key, {
              uploadId: answer.upload_id,
              offset: answer.offset,
              chunkSize: answer.chunk_size ?? item.chunkSize,
              finishing: false,
            });
            continue;
          }
          if (needSync) {
            const status = await this.api.status(item.uploadId);
            needSync = false;
            failures = 0;
            this.update(key, { offset: status.offset, finishing: false });
            continue;
          }
          if (item.file === null) {
            this.update(key, { state: "stalled" });
            return;
          }
          const end = Math.min(item.size, item.offset + item.chunkSize);
          this.update(key, { finishing: end === item.size });
          const answer = await this.api.patch(item.uploadId, item.offset, item.file.slice(item.offset, end), controller.signal);
          failures = 0;
          if (answer.done) {
            this.land(key);
            return;
          }
          this.update(key, {
            offset: answer.offset,
            busy: false,
            finishing: false,
            samples: addSample(item.samples, { at: this.now(), offset: answer.offset }),
          });
        } catch (error) {
          if (!(error instanceof ApiError)) {
            if (this.find(key)?.state === "going") {
              this.update(key, { state: "stalled", message: error instanceof Error ? error.message : String(error) });
            }
            return;
          }
          if (error.code === "aborted") return;
          if (isSessionLost(error)) {
            // A pause can't abort start/status, so the write must not undo it —
            // but the app still needs to hear about the lost session either way.
            if (this.find(key)?.state === "going") this.update(key, { state: "stalled" });
            this.lost(error.code);
            return;
          }
          switch (error.code) {
            case "offset_mismatch":
              this.update(key, { offset: numberOr(error.details.offset, item.offset) });
              continue;
            case "project_busy":
              // Only the finishing step takes the project lock, so every byte is already in.
              if (this.find(key)?.state !== "going") return;
              this.update(key, { busy: true, offset: item.size });
              await this.sleep(BUSY_RETRY_MS);
              continue;
            case "disk_full":
              if (this.find(key)?.state !== "going") return;
              this.update(key, { state: "noRoom", offset: numberOr(error.details.offset, item.offset) });
              return;
            case "not_enough_space":
              if (this.find(key)?.state !== "going") return;
              this.update(key, { state: "noRoom", freeBytes: numberOr(error.details.free_bytes, null) });
              return;
            case "unreachable":
              failures += 1;
              if (failures > NETWORK_RETRIES) {
                if (this.find(key)?.state !== "going") return;
                this.update(key, { state: "stalled" });
                return;
              }
              await this.sleep(2000 * 2 ** (failures - 1));
              needSync = item.uploadId !== null;
              continue;
            case "upload_not_found":
              if (this.find(key)?.finishing) {
                this.land(key);
                return;
              }
              if (restarted) {
                if (this.find(key)?.state !== "going") return;
                this.fail(key, error);
                return;
              }
              restarted = true;
              this.update(key, { uploadId: null, offset: 0, samples: [], finishing: false });
              continue;
            case "permission_denied":
              if (this.find(key)?.state !== "going") return;
              // The finish was refused after every byte was staged; drop them so a
              // reload doesn't bring the upload back as closed at 100%.
              if (item.uploadId !== null) {
                void this.api.cancel(item.uploadId).catch(() => {});
                this.update(key, { uploadId: null });
              }
              this.fail(key, error);
              return;
            default:
              if (this.find(key)?.state !== "going") return;
              this.fail(key, error);
              return;
          }
        }
      }
    } finally {
      if (this.active?.controller === controller) this.active = null;
    }
  }

  private lost(reason: SessionLoss): void {
    if (!this.disposed) this.onSessionLost(reason);
  }

  private land(key: string): void {
    const item = this.find(key);
    if (!item) return;
    this.update(key, { state: "done", offset: item.size, busy: false, file: null });
    try {
      this.onLanded(this.find(key)!);
    } catch {
      // The file is in the project; a failing listener can't make that untrue.
    }
  }

  private fail(key: string, error: ApiError): void {
    this.update(key, { state: "failed", reason: error.code, message: error.message });
  }

  private find(key: string): UploadItem | undefined {
    return this.items.find((i) => i.key === key);
  }

  private update(key: string, patch: Partial<UploadItem>): void {
    if (!this.find(key)) return;
    this.items = this.items.map((i) => (i.key === key ? { ...i, ...patch } : i));
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
