/** Console-only diagnostics. Use a monotonic clock for durations and UTC for correlation. */
let nextTraceId = 0;
type TimingLog = (event: string, details?: Record<string, unknown>) => void;

export const startTimingLog = (
  enabled: boolean,
  operation: string,
  details: Record<string, unknown> = {},
): TimingLog => {
  if (!enabled) return () => {};

  const id = ++nextTraceId;
  const started = performance.now();
  const log = (event: string, eventDetails: Record<string, unknown> = {}) => {
    const now = performance.now();
    // Serialize immediately: Safari otherwise displays lazily evaluated objects.
    console.log(
      `[BLE timing] ${JSON.stringify({
        ...details,
        ...eventDetails,
        id,
        event: `${operation}.${event}`,
        time: new Date().toISOString(),
        atMs: Math.round(now * 100) / 100,
        elapsedMs: Math.round((now - started) * 100) / 100,
      })}`,
    );
  };
  log("start");
  return log;
};
