import { describe, expect, it } from "vitest";
import { addSample, secondsLeft, timeLeftWords, type Sample } from "./eta";

describe("time left", () => {
  it("says nothing until it has five seconds of samples", () => {
    const samples: Sample[] = [{ at: 0, offset: 0 }, { at: 4000, offset: 4000 }];
    expect(secondsLeft(samples, 1000)).toBeNull();
  });

  it("divides what's left by the speed over the window", () => {
    const samples: Sample[] = [{ at: 0, offset: 0 }, { at: 10_000, offset: 10_000 }];
    expect(secondsLeft(samples, 60_000)).toBe(60);
  });

  it("says nothing when a stall filled the window, instead of 'about 3 days'", () => {
    let samples: Sample[] = [];
    for (let at = 0; at <= 25_000; at += 5000) samples = addSample(samples, { at, offset: 100 });
    expect(secondsLeft(samples, 10_000_000)).toBeNull();
  });

  it("drops samples older than twenty seconds", () => {
    let samples: Sample[] = [];
    for (let at = 0; at <= 30_000; at += 10_000) samples = addSample(samples, { at, offset: at });
    expect(samples.map((s) => s.at)).toEqual([10_000, 20_000, 30_000]);
  });

  it("words minutes and hours the way the board does", () => {
    expect(timeLeftWords(30)).toBe("less than a minute left");
    expect(timeLeftWords(240)).toBe("about 4 minutes left");
    expect(timeLeftWords(90)).toBe("about 2 minutes left");
    expect(timeLeftWords(7200)).toBe("about 2 hours left");
  });
});
