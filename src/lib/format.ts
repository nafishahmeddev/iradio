/** Elapsed time as MM:SS, or HH:MM:SS past the hour. */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours ? `${pad(hours)}:${rest}` : rest;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
