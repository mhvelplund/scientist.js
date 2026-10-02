interface CpuUsage {
  user: number;
  system: number;
}

interface TimingGlobals {
  performance?: { now(): number };
  process?: { cpuUsage?: () => CpuUsage };
}

const env = globalThis as TimingGlobals;

/** Monotonic wall clock time in seconds. */
export function wallTime(): number {
  return env.performance ? env.performance.now() / 1000 : Date.now() / 1000;
}

/** Process CPU time (user + system) in seconds, or 0 where unavailable (e.g. browsers). */
export function cpuTime(): number {
  const usage = env.process?.cpuUsage?.();
  return usage ? (usage.user + usage.system) / 1e6 : 0;
}

/** Capture [wall, cpu] times, in seconds. */
export function captureTimes(): [number, number] {
  return [wallTime(), cpuTime()];
}
