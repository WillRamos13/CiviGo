/** A lost GPU context is recoverable without discarding the trip or map camera. */
export class MapRecoveryController {
  private lost = false;
  private foreground = true;
  private disposed = false;
  private rebuilding = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private actions: { lost(): void; restored(): void; rebuild(): void }, private delay = 15000) {}
  contextLost(): void {
    if (this.disposed || this.lost) return;
    this.lost = true; this.rebuilding = false;
    this.actions.lost(); this.arm();
  }
  contextRestored(): void {
    if (this.disposed || !this.lost || this.rebuilding) return;
    this.lost = false; this.clear(); this.actions.restored();
  }
  setForeground(value: boolean): void {
    if (this.disposed) return;
    this.foreground = value;
    if (value) this.arm(); else this.clear();
  }
  dispose(): void { this.disposed = true; this.clear(); }
  private clear(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private arm(): void {
    if (!this.lost || !this.foreground || this.disposed || this.rebuilding || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.lost || !this.foreground || this.disposed || this.rebuilding) return;
      this.rebuilding = true; this.actions.rebuild();
    }, this.delay);
  }
}
