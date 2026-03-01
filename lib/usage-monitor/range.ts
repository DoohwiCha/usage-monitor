import type { RangePreset, ResolvedRange } from "@/lib/usage-monitor/types";

export function resolveRange(input: string | null): ResolvedRange {
  const preset: RangePreset = input === "day" || input === "month" ? input : "week";
  const end = new Date();
  const start = new Date(end);

  if (preset === "day") {
    start.setDate(start.getDate() - 1);
  } else if (preset === "week") {
    start.setDate(start.getDate() - 7);
  } else {
    start.setDate(start.getDate() - 30);
  }

  return {
    preset,
    start,
    end,
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix: Math.floor(end.getTime() / 1000),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function toUtcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
