import { createApi, type Api } from "../api/client";
import { projectPath } from "../projects/queries";

export interface StartBody {
  path: string;
  size: number;
  fingerprint: string;
  replace: boolean;
}

export interface StartAnswer {
  upload_id: string;
  offset: number;
  size: number;
  chunk_size?: number;
  done: boolean;
}

export interface ChunkAnswer {
  upload_id: string;
  offset: number;
  size: number;
  done: boolean;
}

export interface PendingUpload {
  id: string;
  project_id: string;
  path: string;
  size: number;
  offset: number;
  fingerprint: string;
  replace: boolean;
  updated_at: number;
}

export interface Disk {
  free_bytes: number;
  total_bytes: number;
}

export interface UploadApi {
  start(projectId: string, body: StartBody): Promise<StartAnswer>;
  patch(uploadId: string, offset: number, chunk: Blob, signal: AbortSignal): Promise<ChunkAnswer>;
  status(uploadId: string): Promise<PendingUpload>;
  cancel(uploadId: string): Promise<unknown>;
  pending(projectId: string): Promise<{ uploads: PendingUpload[] }>;
  disk(): Promise<Disk>;
}

const uploadPath = (id: string) => `/api/uploads/${encodeURIComponent(id)}`;

// The shared client gives up after 10 s; an 8 MiB chunk on a slow link needs longer.
export function createUploadApi(client: Api = createApi((input, init) => fetch(input, init), { timeoutMs: 120_000 })): UploadApi {
  return {
    start: (projectId, body) => client.post(`${projectPath(projectId)}/uploads`, body),
    patch: (id, offset, chunk, signal) => client.patch(uploadPath(id), chunk, { "Upload-Offset": String(offset) }, signal),
    status: (id) => client.get(uploadPath(id)),
    cancel: (id) => client.del(uploadPath(id)),
    pending: (projectId) => client.get(`${projectPath(projectId)}/uploads`),
    disk: () => client.get("/api/disk"),
  };
}
