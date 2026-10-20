import type { LocationFix } from '../types';

export interface NavigationSpeed { kmh: number | null; available: boolean; }
const unavailable = (): NavigationSpeed => ({ kmh: null, available: false });

/** GPS speed is m/s. No road limit is inferred from it or from route averages. */
export class NavigationSpeedFilter {
  private samples: { value: number; timestamp: number }[] = [];
  private lastSeen = -Infinity;
  reset() { this.samples = []; this.lastSeen = -Infinity; }
  update(fix: LocationFix | null | undefined, now = Date.now()): NavigationSpeed {
    const timestamp = fix?.timestamp;
    if (!fix || timestamp === undefined || !Number.isFinite(timestamp) || timestamp > now + 2000 || now - timestamp > 8000 ||
        fix.accuracy === undefined || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 40 ||
        fix.speed === undefined || !Number.isFinite(fix.speed) || fix.speed < 0 || fix.speed > 90) return unavailable();
    this.samples = this.samples.filter(sample => now - sample.timestamp <= 8000);
    if (timestamp < this.lastSeen) return unavailable();
    if (timestamp === this.lastSeen && this.samples[this.samples.length - 1]?.timestamp !== timestamp) return unavailable();
    if (timestamp > this.lastSeen) {
      const last = this.samples[this.samples.length - 1];
      this.lastSeen = timestamp;
      // A single implausible acceleration cannot become a displayed speed.
      if (last && Math.abs(fix.speed - last.value) > 4 + 8 * (timestamp - last.timestamp) / 1000) return unavailable();
      this.samples.push({ value: fix.speed < 0.8 ? 0 : fix.speed, timestamp });
      this.samples = this.samples.slice(-5);
    }
    if (!this.samples.length || now - this.samples[this.samples.length - 1].timestamp > 8000) return unavailable();
    const values = this.samples.map(sample => sample.value).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return { kmh: Math.round(median * 3.6), available: true };
  }
}
