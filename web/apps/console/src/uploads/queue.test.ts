import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { fakeAgent, file } from "./fakeAgent";
import { UploadQueue, type UploadItem } from "./queue";

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
    agent.state.skew = 4;
    const [key] = queue.add("p", "", [file("a.txt", "abcdefghij")]);
    await queue.settled();
    expect(agent.calls).toEqual(["start a.txt", "patch up1 @0+4", "patch up1 @4+4", "patch up1 @8+2"]);
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
