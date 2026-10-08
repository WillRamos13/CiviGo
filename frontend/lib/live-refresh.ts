export interface LiveRefreshEnvironment {
    available: () => boolean;
    subscribe: (change: () => void) => () => void;
    schedule: (callback: () => void, milliseconds: number) => unknown;
    cancel: (timer: unknown) => void;
}

export interface LiveRefresh {
    refresh: () => void;
    stop: () => void;
}

export function browserRefreshEnvironment(): LiveRefreshEnvironment {
    return {
        available: () => document.visibilityState !== 'hidden' && navigator.onLine !== false,
        subscribe(change) {
            const events = ['focus', 'pageshow', 'online', 'offline'];
            for (const event of events) window.addEventListener(event, change);
            document.addEventListener('visibilitychange', change);
            return () => {
                for (const event of events) window.removeEventListener(event, change);
                document.removeEventListener('visibilitychange', change);
            };
        },
        schedule: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
        cancel: timer => window.clearTimeout(timer as number),
    };
}

// Programar desde el final de cada lectura evita solapar consultas o cancelar
// una respuesta lenta en cada intervalo. Las mutaciones solicitan una única
// lectura adicional; los eventos de foco/reconexión comparten la que está activa.
export function startLiveRefresh(
    load: (signal: AbortSignal) => Promise<void>,
    intervalMs: number,
    environment: LiveRefreshEnvironment = browserRefreshEnvironment(),
): LiveRefresh {
    let stopped = false;
    let timer: unknown;
    let request: AbortController | null = null;
    let running: Promise<void> | null = null;
    let queued = false;
    const clearTimer = () => {
        if (timer !== undefined) environment.cancel(timer);
        timer = undefined;
    };
    const run = (force = false) => {
        clearTimer();
        if (stopped || !environment.available()) return;
        if (running) {
            if (force || request?.signal.aborted) queued = true;
            return;
        }
        const controller = new AbortController();
        request = controller;
        running = Promise.resolve().then(() => {
            if (!controller.signal.aborted) return load(controller.signal);
        }).catch(() => {
            // El consumidor muestra el error y conserva los últimos datos.
            // También se vuelve a intentar después de un fallo de la lectura.
        }).finally(() => {
            running = null;
            request = null;
            if (stopped || !environment.available()) return;
            if (queued) {
                queued = false;
                run();
            } else timer = environment.schedule(() => run(), intervalMs);
        });
    };
    const unsubscribe = environment.subscribe(() => {
        if (!environment.available()) {
            clearTimer();
            queued = false;
            request?.abort();
        } else run();
    });
    run();
    return {
        refresh: () => run(true),
        stop() {
            stopped = true;
            clearTimer();
            queued = false;
            request?.abort();
            unsubscribe();
        },
    };
}
