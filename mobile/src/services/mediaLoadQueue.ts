/** Keep native binary/base64 downloads bounded, including canceled in-flight calls. */
export class MediaLoadQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly limit = 2) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid media concurrency.');
  }

  run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Carga cancelada.', 'AbortError')); return; }
      let started = false;
      const cancel = () => {
        if (started) return;
        this.waiting = this.waiting.filter(item => item !== start);
        reject(new DOMException('Carga cancelada.', 'AbortError'));
      };
      const start = () => {
        if (signal.aborted) { cancel(); return; }
        started = true;
        signal.removeEventListener('abort', cancel);
        this.active++;
        // An aborted Capacitor call still owns its slot until Java releases its
        // response. Releasing early would allow unbounded detached downloads.
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.active--;
          this.drain();
        });
      };
      signal.addEventListener('abort', cancel, { once: true });
      this.waiting.push(start);
      this.drain();
    });
  }

  private drain() {
    while (this.active < this.limit && this.waiting.length) this.waiting.shift()!();
  }
}

export const mediaLoadQueue = new MediaLoadQueue(2);
