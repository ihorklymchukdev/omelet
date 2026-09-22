import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { fakeAgent, file, until } from "./fakeAgent";
import { UploadQueue, type UploadItem } from "./queue";
import type { PendingUpload } from "./uploadApi";

function setup() {
  const agent = fakeAgent();
  const landed: UploadItem[] = [];
  const lost: string[] = [];
  const queue = new UploadQueue({
    api: agent.api,
    sleep: agent.sleep,
    onLanded: (item) => landed.push(item),
    onSessionLost: (reason) => lost.push(reason),
  });
  const item = (key: string) => queue.snapshot().find((i) => i.key === key)!;
  return { agent, queue, landed, lost, item };
}

describe("UploadQueue protocol", () => {
  it("sends a file in chunk_size slices, in order, and lands it", async () => {
    const { agent, queue, landed, item } = setup();
    const [key] = queue.add("p", "data", [file("a.sql", "abcdefghij")]);
    await queue.settled();
    expect(agent.calls).toEqual(["start data/a.sql", "patch up1 @0+4", "patch up1 @4+4", "patch up1 @8+2"]);
    expect(item(key).state).toBe("done");
    expect(landed.map((i) => i.name)).toEqual(["a.sql"]);
  });

  it("carries on from the offset the agent reports after an offset_mismatch", async () => {
    const { agent, queue, item } = setup();
    agent.state.skew = 8;
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await queue.settled();
    expect(agent.calls).toEqual(["start a.txt", "patch up1 @0+4", "patch up1 @8+2"]);
    expect(item(key).state).toBe("done");
  });

  it("retries an empty PATCH at the full size while the project is busy, until it lands", async () => {
    const { agent, queue, item } = setup();
    agent.state.busyOnFinish = 2;
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await queue.settled();
    expect(agent.calls.slice(-3)).toEqual(["patch up1 @8+2", "patch up1 @10+0", "patch up1 @10+0"]);
    expect(agent.sleeps).toEqual([3000, 3000]);
    expect(item(key).state).toBe("done");
  });

  it("stops at the agent's offset on disk_full and starts nothing else", async () => {
    const { agent, queue, item } = setup();
    agent.failOn("patch", 2, new ApiError("disk_full", "full", 507, { offset: 4 }));
    const [a, b] = queue.add("p", "", [file("a.txt", "abcdefghij"), file("b.txt", "xyz")]);
    await queue.settled();
    expect(item(a)).toMatchObject({ state: "noRoom", offset: 4 });
    expect(item(b).state).toBe("waiting");
    expect(agent.calls.some((c) => c.startsWith("start b.txt"))).toBe(false);
  });

  it("sends one file at a time, in the order they were added", async () => {
    const { agent, queue } = setup();
    queue.add("p", "", [file("a.txt", "abcde"), file("b.txt", "xy")]);
    await queue.settled();
    expect(agent.calls).toEqual(["start a.txt", "patch up1 @0+4", "patch up1 @4+1", "start b.txt", "patch up2 @0+2"]);
  });

  it("marks an upload stalled after three failed status reads on a dropped connection", async () => {
    const { agent, queue, item } = setup();
    const gone = new ApiError("unreachable", "down", 0);
    agent.failOn("patch", 1, gone);
    agent.failOn("status", 1, gone);
    agent.failOn("status", 2, gone);
    agent.failOn("status", 3, gone);
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await queue.settled();
    expect(agent.sleeps).toEqual([2000, 4000, 8000]);
    expect(item(key)).toMatchObject({ state: "stalled", offset: 0 });
  });

  it("restarts from zero once when the agent lost the upload, then gives up", async () => {
    const { agent, queue, item } = setup();
    const lost = new ApiError("upload_not_found", "no such upload", 404);
    agent.failOn("patch", 1, lost);
    agent.failOn("patch", 2, lost);
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await queue.settled();
    expect(agent.calls).toEqual(["start a.txt", "patch up1 @0+4", "start a.txt", "patch up2 @0+4"]);
    expect(item(key)).toMatchObject({ state: "failed", reason: "upload_not_found" });
  });

  it("lands an upload whose finishing response was lost, instead of restarting it", async () => {
    const { agent, queue, landed, item } = setup();
    agent.state.loseResponseAt = 3; // the last patch, @8+2, completes the file on the agent
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await queue.settled();
    expect(agent.calls).toEqual(["start a.txt", "patch up1 @0+4", "patch up1 @4+4", "patch up1 @8+2", "status up1"]);
    expect(item(key).state).toBe("done");
    expect(landed.map((i) => i.name)).toEqual(["a.txt"]);
  });

  it("fails a start the agent refuses and keeps going with the next file", async () => {
    const { agent, queue, item } = setup();
    agent.failOn("start", 1, new ApiError("file_exists", "'a.txt' is already in the project", 409));
    const [a, b] = queue.add("p", "", [file("a.txt", "abc"), file("b.txt", "xy")]);
    await queue.settled();
    expect(item(a)).toMatchObject({ state: "failed", reason: "file_exists" });
    expect(item(b).state).toBe("done");
  });

  it("hands a lost session to the app instead of failing the upload", async () => {
    const { agent, queue, lost, item } = setup();
    agent.failOn("patch", 1, new ApiError("session_expired", "gone", 401));
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await queue.settled();
    expect(lost).toEqual(["session_expired"]);
    expect(item(key).state).toBe("stalled");
  });
});

describe("UploadQueue controls", () => {
  it("pauses by aborting the chunk and re-reads the server offset before resuming", async () => {
    const { agent, queue, item } = setup();
    agent.state.hangAt = 2;
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await until(() => agent.calls.length === 3);
    queue.pause(key);
    await queue.settled();
    expect(item(key)).toMatchObject({ state: "paused", offset: 4 });
    agent.state.hangAt = 0;
    queue.resume(key);
    await queue.settled();
    expect(agent.calls.slice(3)).toEqual(["status up1", "patch up1 @4+4", "patch up1 @8+2"]);
    expect(item(key).state).toBe("done");
  });

  it("cancels a started upload on the agent when it is removed, then moves on", async () => {
    const { agent, queue } = setup();
    agent.state.hangAt = 1;
    const [a] = queue.add("p", "", [file("a.txt", "abcdefghij"), file("b.txt", "xy")]);
    await until(() => agent.calls.length === 2);
    queue.remove(a);
    await until(() => queue.snapshot().every((i) => i.state === "done"));
    expect(agent.calls).toContain("cancel up1");
    expect(queue.snapshot().map((i) => i.name)).toEqual(["b.txt"]);
  });

  it("resends a refused duplicate with replace once the user says so", async () => {
    const { agent, queue, item } = setup();
    agent.failOn("start", 1, new ApiError("file_exists", "exists", 409));
    const [key] = queue.add("p", "data", [file("a.txt", "abc")]);
    await queue.settled();
    queue.replace(key);
    await queue.settled();
    expect(agent.calls).toContain("start data/a.txt replace");
    expect(item(key).state).toBe("done");
  });

  const pending = (over: Partial<PendingUpload> = {}): PendingUpload => ({
    id: "srv1", project_id: "p", path: "data/a.txt", size: 10, offset: 4,
    fingerprint: "a.txt:10:7", replace: false, updated_at: 0, ...over,
  });

  it("refuses to resume a reloaded upload with a different file", async () => {
    const { queue, item } = setup();
    queue.adoptPending("p", [pending()]);
    expect(queue.relink("srv1", file("a.txt", "abcdefghij", 8))).toBe(false);
    expect(item("srv1")).toMatchObject({ state: "stalled", file: null });
  });

  it("resumes a reloaded upload from the server's offset once given the same file", async () => {
    const { agent, queue, item } = setup();
    agent.uploads.set("srv1", { size: 10, offset: 4, path: "data/a.txt" });
    queue.adoptPending("p", [pending()]);
    expect(item("srv1")).toMatchObject({ dir: "data", name: "a.txt", fromReload: true });
    expect(queue.relink("srv1", file("a.txt", "abcdefghij", 7))).toBe(true);
    await queue.settled();
    // No start answer after a reload, so the chunk size is the 8 MiB default: one PATCH finishes it.
    expect(agent.calls).toEqual(["status srv1", "patch srv1 @4+6"]);
    expect(item("srv1").state).toBe("done");
  });

  it("doesn't add a second row for an upload it already holds", () => {
    const { queue } = setup();
    queue.adoptPending("p", [pending()]);
    queue.adoptPending("p", [pending()]);
    expect(queue.snapshot()).toHaveLength(1);
  });

  it("carries on after disk_full only once the agent reports room", async () => {
    const { agent, queue, item } = setup();
    agent.failOn("patch", 2, new ApiError("disk_full", "full", 507, { offset: 4 }));
    const [a, b] = queue.add("p", "", [file("a.txt", "abcdefghij"), file("b.txt", "xy")]);
    await queue.settled();
    agent.state.free = 3;
    expect(await queue.carryOn()).toBe(false);
    expect(item(a).state).toBe("noRoom");
    agent.state.free = 100;
    expect(await queue.carryOn()).toBe(true);
    await until(() => item(b).state === "done");
    expect(item(a).state).toBe("done");
  });

  it("hands a lost session to the app instead of throwing out of carryOn", async () => {
    const lost: string[] = [];
    const queue = new UploadQueue({
      api: {
        start: async () => ({ upload_id: "up1", offset: 0, size: 10, chunk_size: 4, done: false }),
        patch: async () => {
          throw new Error("not used by this test");
        },
        status: async () => {
          throw new Error("not used by this test");
        },
        cancel: async () => ({}),
        pending: async () => ({ uploads: [] }),
        disk: async () => {
          throw new ApiError("session_expired", "gone", 401);
        },
      },
      onSessionLost: (reason) => lost.push(reason),
    });
    expect(await queue.carryOn()).toBe(false);
    expect(lost).toEqual(["session_expired"]);
  });

  it("doesn't let a disk_full write that lands after a pause turn the item noRoom", async () => {
    const landed: UploadItem[] = [];
    let rejectPatch: ((error: unknown) => void) | null = null;
    const queue = new UploadQueue({
      api: {
        start: async () => ({ upload_id: "up1", offset: 0, size: 10, chunk_size: 4, done: false }),
        patch: () => new Promise((_resolve, reject) => (rejectPatch = reject)),
        status: async () => {
          throw new Error("not used by this test");
        },
        cancel: async () => ({}),
        pending: async () => ({ uploads: [] }),
        disk: async () => ({ free_bytes: 0, total_bytes: 0 }),
      },
      onLanded: (i) => landed.push(i),
    });
    const item = (key: string) => queue.snapshot().find((i) => i.key === key)!;
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await until(() => rejectPatch !== null);
    queue.pause(key);
    rejectPatch!(new ApiError("disk_full", "full", 507, { offset: 4 }));
    await queue.settled();
    expect(item(key).state).toBe("paused");
  });

  it("still reports a lost session when it was paused while start was in flight", async () => {
    const lost: string[] = [];
    let rejectStart: ((error: unknown) => void) | null = null;
    const queue = new UploadQueue({
      api: {
        start: () => new Promise((_resolve, reject) => (rejectStart = reject)),
        patch: async () => {
          throw new Error("not used by this test");
        },
        status: async () => {
          throw new Error("not used by this test");
        },
        cancel: async () => ({}),
        pending: async () => ({ uploads: [] }),
        disk: async () => ({ free_bytes: 0, total_bytes: 0 }),
      },
      onSessionLost: (reason) => lost.push(reason),
    });
    const item = (key: string) => queue.snapshot().find((i) => i.key === key)!;
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await until(() => rejectStart !== null);
    queue.pause(key);
    rejectStart!(new ApiError("session_expired", "gone", 401));
    await queue.settled();
    expect(lost).toEqual(["session_expired"]);
    expect(item(key).state).toBe("paused");
  });
});
