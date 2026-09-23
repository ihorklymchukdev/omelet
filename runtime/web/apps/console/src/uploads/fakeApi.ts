import { ApiError } from "../api/client";
import type { PendingUpload, UploadApi } from "./uploadApi";

type Method = "start" | "patch" | "status";

export function fakeApi() {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const uploads = new Map<string, { size: number; offset: number; path: string }>();
  const counts: Record<Method, number> = { start: 0, patch: 0, status: 0 };
  const scripted: Array<{ method: Method; at: number; error: Error }> = [];
  const state = { next: 0, free: 100 * 1024 ** 3, skew: 0, busyOnFinish: 0, hangAt: 0, loseResponseAt: 0, hangAfterApplyAt: 0 };

  function scriptedFailure(method: Method): void {
    counts[method] += 1;
    const hit = scripted.find((s) => s.method === method && s.at === counts[method]);
    if (hit) throw hit.error;
  }

  const api: UploadApi = {
    async start(_projectId, body) {
      calls.push(`start ${body.path}${body.replace ? " replace" : ""}`);
      scriptedFailure("start");
      const id = `up${++state.next}`;
      uploads.set(id, { size: body.size, offset: state.skew, path: body.path });
      return { upload_id: id, offset: 0, size: body.size, chunk_size: 4, done: body.size === 0 };
    },
    patch(id, offset, chunk, signal) {
      calls.push(`patch ${id} @${offset}+${chunk.size}`);
      try {
        scriptedFailure("patch");
      } catch (error) {
        return Promise.reject(error);
      }
      if (state.hangAt === counts.patch) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new ApiError("aborted", "cancelled", 0)));
        });
      }
      const up = uploads.get(id);
      if (!up) return Promise.reject(new ApiError("upload_not_found", "no such upload", 404));
      if (offset !== up.offset) return Promise.reject(new ApiError("offset_mismatch", "m", 409, { offset: up.offset }));
      up.offset += chunk.size;
      if (up.offset === up.size && state.busyOnFinish > 0) {
        state.busyOnFinish -= 1;
        return Promise.reject(new ApiError("project_busy", "busy", 409));
      }
      const done = up.offset === up.size;
      if (done) uploads.delete(id);
      // The API took the chunk, but the client gave up waiting (a pause).
      if (state.hangAfterApplyAt === counts.patch) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new ApiError("aborted", "cancelled", 0)));
        });
      }
      // The chunk lands on the API, but its answer never makes it back.
      if (state.loseResponseAt === counts.patch) return Promise.reject(new ApiError("unreachable", "down", 0));
      return Promise.resolve({ upload_id: id, offset: up.offset, size: up.size, done });
    },
    async status(id) {
      calls.push(`status ${id}`);
      scriptedFailure("status");
      const up = uploads.get(id);
      if (!up) throw new ApiError("upload_not_found", "no such upload", 404);
      const pending: PendingUpload = {
        id, project_id: "p", path: up.path, size: up.size, offset: up.offset, fingerprint: "", replace: false, updated_at: 0,
      };
      return pending;
    },
    async cancel(id) {
      calls.push(`cancel ${id}`);
      uploads.delete(id);
      return {};
    },
    async pending() {
      return { uploads: [] };
    },
    async disk() {
      return { free_bytes: state.free, total_bytes: 200 * 1024 ** 3 };
    },
  };

  return {
    api,
    calls,
    sleeps,
    uploads,
    state,
    failOn(method: Method, at: number, error: Error) {
      scripted.push({ method, at, error });
    },
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

export function file(name: string, contents: string, lastModified = 1): File {
  return new File([contents], name, { lastModified });
}

export async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition never became true");
}
