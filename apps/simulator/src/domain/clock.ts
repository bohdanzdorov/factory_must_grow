// The backend's simulated clock, as seen from here. The simulator never runs a scaled clock of
// its own, because two clocks started at different real times drift apart. It reads
// GET /api/clock and estimates between readings from the scale, like the UI does.
import type { ClockState } from '@factorymustgrow/shared';

export class BackendClock {
  private constructor(
    private simulatedAt: number,
    private realAt: number,
    private currentScale: number,
    private readonly realNow: () => number,
  ) {}

  static fromState(state: ClockState, realNow: () => number = Date.now): BackendClock {
    return new BackendClock(Date.parse(state.now), realNow(), state.scale, realNow);
  }

  update(state: ClockState): void {
    this.simulatedAt = Date.parse(state.now);
    this.realAt = this.realNow();
    this.currentScale = state.scale;
  }

  // Simulated milliseconds per real millisecond.
  get scale(): number {
    return this.currentScale;
  }

  now(): Date {
    const elapsedReal = Math.max(0, this.realNow() - this.realAt);
    return new Date(this.simulatedAt + elapsedReal * this.currentScale);
  }
}
