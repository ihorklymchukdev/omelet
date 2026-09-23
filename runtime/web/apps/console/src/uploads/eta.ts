export interface Sample {
  at: number;
  offset: number;
}

const WINDOW_MS = 20_000;
const MIN_SPAN_MS = 5000;
const MAX_SECONDS = 86_400;

export function addSample(samples: readonly Sample[], sample: Sample): Sample[] {
  return [...samples, sample].filter((s) => sample.at - s.at <= WINDOW_MS);
}

export function secondsLeft(samples: readonly Sample[], remaining: number): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = last.at - first.at;
  if (span < MIN_SPAN_MS) return null;
  const perSecond = (last.offset - first.offset) / (span / 1000);
  if (perSecond <= 0) return null;
  const seconds = remaining / perSecond;
  return seconds > MAX_SECONDS ? null : seconds;
}

export function timeLeftWords(seconds: number): string {
  if (seconds < 60) return "less than a minute left";
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
  }
  const hours = Math.round(seconds / 3600);
  return `about ${hours} ${hours === 1 ? "hour" : "hours"} left`;
}
