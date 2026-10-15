export interface OperationToken {
  signal: AbortSignal;
  isActive(): boolean;
  assertActive(): void;
  finish(): void;
}

export class OperationScope {
  private controllers = new Set<AbortController>();
  constructor(private identity: () => string, private mounted: () => boolean = () => true) {}

  begin(): OperationToken {
    const owner = this.identity();
    const controller = new AbortController();
    this.controllers.add(controller);
    const isActive = () => !controller.signal.aborted && this.mounted() && this.identity() === owner;
    return {
      signal: controller.signal,
      isActive,
      assertActive: () => {
        if (!isActive()) throw new DOMException('La operación se canceló porque cambió la cuenta o el incidente.', 'AbortError');
      },
      finish: () => { this.controllers.delete(controller); },
    };
  }

  cancel(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}
