import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';

const {startLiveRefresh, browserRefreshEnvironment} = loadTs('lib/live-refresh.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return {promise, resolve, reject};
};

function fixture({visible = true, online = true} = {}) {
    let now = 0, nextTimer = 0;
    const listeners = new Set(), timers = new Map(), calls = [], cancelled = [];
    const state = {visible, online};
    const environment = {
        available: () => state.visible && state.online,
        subscribe(callback) {
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
        schedule(callback, milliseconds) {
            const id = ++nextTimer;
            timers.set(id, {callback, due: now + milliseconds});
            return id;
        },
        cancel(id) { cancelled.push(id); timers.delete(id); },
    };
    const load = signal => {
        const pending = deferred();
        calls.push({signal, ...pending});
        return pending.promise;
    };
    return {
        environment, load, calls, timers, listeners, state, cancelled,
        notify() { for (const listener of listeners) listener(); },
        advance(milliseconds) {
            now += milliseconds;
            const due = [...timers.entries()].filter(([, timer]) => timer.due <= now);
            for (const [id, timer] of due) {
                if (timers.delete(id)) timer.callback();
            }
        },
        now: () => now,
    };
}

test('slow requests stay single-flight during polling and repeated focus events', async () => {
    const f = fixture(), refresh = startLiveRefresh(f.load, 1000, f.environment);
    await tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
    for (let i = 0; i < 5; i++) { f.advance(1000); f.notify(); }
    await tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].signal.aborted, false);
    assert.equal(f.timers.size, 0);
    f.calls[0].resolve(); await tick();
    assert.equal(f.calls.length, 1, 'focus events do not queue another read');
    assert.equal(f.timers.size, 1);
    assert.equal([...f.timers.values()][0].due, f.now() + 1000);
    f.advance(999); await tick();
    assert.equal(f.calls.length, 1);
    f.advance(1); await tick();
    assert.equal(f.calls.length, 2);
    assert.equal(f.timers.size, 0);
    refresh.stop(); f.calls[1].resolve(); await tick();
});

test('focus immediately refreshes idle data and restarts the timer after completion', async () => {
    const f = fixture(), refresh = startLiveRefresh(f.load, 1000, f.environment);
    await tick(); f.calls[0].resolve(); await tick();
    f.advance(100); f.notify(); await tick();
    assert.equal(f.calls.length, 2);
    assert.equal(f.timers.size, 0);
    assert.equal(f.cancelled.length, 1);
    f.calls[1].resolve(); await tick();
    assert.equal([...f.timers.values()][0].due, 1100);
    refresh.stop();
});

for (const condition of ['visible', 'online']) {
    test(`${condition} changes pause timers and immediately refresh when available again`, async () => {
        const f = fixture(), refresh = startLiveRefresh(f.load, 1000, f.environment);
        await tick(); f.calls[0].resolve(); await tick();
        assert.equal(f.timers.size, 1);
        f.state[condition] = false; f.notify();
        assert.equal(f.timers.size, 0);
        f.advance(5000); refresh.refresh(); await tick();
        assert.equal(f.calls.length, 1);
        f.state[condition] = true; f.notify(); await tick();
        assert.equal(f.calls.length, 2);
        assert.equal(f.timers.size, 0);
        refresh.stop(); f.calls[1].resolve(); await tick();
    });

    test(`${condition} changes abort an in-flight request without overlapping its reconnect`, async () => {
        const f = fixture(), refresh = startLiveRefresh(f.load, 1000, f.environment);
        await tick();
        f.state[condition] = false; f.notify();
        assert.equal(f.calls[0].signal.aborted, true);
        assert.equal(f.timers.size, 0);
        f.state[condition] = true; f.notify(); f.notify(); await tick();
        assert.equal(f.calls.length, 1, 'an abort-insensitive loader is still awaited');
        f.calls[0].resolve(); await tick();
        assert.equal(f.calls.length, 2, 'reconnect queues exactly one fresh read');
        assert.equal(f.calls[1].signal.aborted, false);
        assert.equal(f.timers.size, 0);
        refresh.stop(); f.calls[1].resolve(); await tick();
    });
}

test('an unavailable initial browser starts no read until visibility and connection return', async () => {
    const f = fixture({visible: false, online: false});
    const refresh = startLiveRefresh(f.load, 1000, f.environment);
    await tick(); assert.equal(f.calls.length, 0);
    f.state.visible = true; f.notify(); await tick();
    assert.equal(f.calls.length, 0);
    f.state.online = true; f.notify(); await tick();
    assert.equal(f.calls.length, 1);
    refresh.stop(); f.calls[0].resolve(); await tick();
});

test('multiple manual refreshes during a request queue one additional read', async () => {
    const f = fixture(), refresh = startLiveRefresh(f.load, 1000, f.environment);
    await tick();
    refresh.refresh(); refresh.refresh(); refresh.refresh(); f.notify();
    await tick(); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].signal.aborted, false);
    f.calls[0].resolve(); await tick();
    assert.equal(f.calls.length, 2);
    assert.equal(f.timers.size, 0);
    f.calls[1].resolve(); await tick();
    assert.equal(f.calls.length, 2);
    assert.equal(f.timers.size, 1);
    refresh.stop();
});

test('pause discards pending manual refreshes and does not restart while hidden', async () => {
    const f = fixture(), refresh = startLiveRefresh(f.load, 1000, f.environment);
    await tick(); refresh.refresh();
    f.state.visible = false; f.notify();
    f.calls[0].reject(new Error('aborted')); await tick();
    f.advance(5000); f.notify(); await tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
    f.state.visible = true; f.notify(); await tick();
    f.calls[1].resolve(); await tick();
    assert.equal(f.calls.length, 2);
    assert.equal(f.timers.size, 1);
    refresh.stop();
});

test('stop aborts a pending read, discards queued refreshes and removes listeners', async () => {
    const f = fixture(), refresh = startLiveRefresh(f.load, 1000, f.environment);
    await tick(); refresh.refresh();
    assert.equal(f.listeners.size, 1);
    refresh.stop();
    assert.equal(f.calls[0].signal.aborted, true);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.timers.size, 0);
    refresh.refresh(); f.notify(); f.calls[0].resolve(); await tick(); f.advance(10000); await tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
});

test('stop cancels the scheduled retry and prevents its stale callback from loading data', async () => {
    const f = fixture(), refresh = startLiveRefresh(f.load, 1000, f.environment);
    await tick(); f.calls[0].resolve(); await tick();
    const staleCallback = [...f.timers.values()][0].callback;
    refresh.stop();
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
    staleCallback(); refresh.refresh(); f.notify(); await tick();
    assert.equal(f.calls.length, 1);
});

test('a failed read is retried after the normal interval', async () => {
    const f = fixture(), refresh = startLiveRefresh(f.load, 1000, f.environment);
    await tick(); f.calls[0].reject(new Error('temporarily unavailable')); await tick();
    assert.equal(f.timers.size, 1);
    f.advance(999); await tick(); assert.equal(f.calls.length, 1);
    f.advance(1); await tick(); assert.equal(f.calls.length, 2);
    f.calls[1].resolve(); await tick();
    assert.equal(f.timers.size, 1);
    refresh.stop();
});

test('a synchronous loader failure also schedules a retry', async () => {
    const f = fixture(); let count = 0;
    const refresh = startLiveRefresh(() => { count++; throw new Error('failed'); }, 1000, f.environment);
    await tick(); assert.equal(count, 1); assert.equal(f.timers.size, 1);
    f.advance(1000); await tick(); assert.equal(count, 2); assert.equal(f.timers.size, 1);
    refresh.stop();
});

test('browser environment observes availability and unsubscribes all relevant events', () => {
    const old = new Map(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const browser = new EventTarget(), document = new EventTarget(), navigator = {onLine: true};
    document.visibilityState = 'visible';
    const scheduled = [], cleared = [];
    browser.setTimeout = (callback, delay) => { scheduled.push({callback, delay}); return 7; };
    browser.clearTimeout = id => cleared.push(id);
    for (const [key, value] of Object.entries({window: browser, document, navigator})) {
        Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
    }
    try {
        const environment = browserRefreshEnvironment();
        assert.equal(environment.available(), true);
        document.visibilityState = 'hidden'; assert.equal(environment.available(), false);
        document.visibilityState = 'visible'; navigator.onLine = false; assert.equal(environment.available(), false);
        navigator.onLine = true;
        let changes = 0;
        const unsubscribe = environment.subscribe(() => changes++);
        for (const event of ['focus', 'pageshow', 'online', 'offline']) browser.dispatchEvent(new Event(event));
        document.dispatchEvent(new Event('visibilitychange'));
        assert.equal(changes, 5);
        browser.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('focus'));
        assert.equal(changes, 5, 'window/document event targets are not interchanged');
        unsubscribe();
        for (const event of ['focus', 'pageshow', 'online', 'offline']) browser.dispatchEvent(new Event(event));
        document.dispatchEvent(new Event('visibilitychange'));
        assert.equal(changes, 5);
        const callback = () => {};
        environment.cancel(environment.schedule(callback, 123));
        assert.deepEqual(scheduled, [{callback, delay: 123}]);
        assert.deepEqual(cleared, [7]);
    } finally {
        for (const [key, descriptor] of old) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
});
