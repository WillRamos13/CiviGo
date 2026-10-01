import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadTs } from './helpers/ts-module.mjs';

const { ThemeController, INITIAL_THEME, THEME_BOOTSTRAP_SCRIPT, THEME_STORAGE_KEY } = loadTs('lib/theme.ts');

function browser({ saved = null, dark = false, blocked = false, onWrite } = {}) {
    const systemListeners = new Set(), storageListeners = new Set();
    const painted = [], written = [];
    let preference = saved, systemDark = dark;
    return {
        painted, written, systemListeners, storageListeners,
        environment: {
            readPreference: () => {
                if (blocked) throw new Error('storage blocked');
                return preference;
            },
            writePreference: value => {
                if (blocked) throw new Error('storage blocked');
                preference = value;
                written.push(value);
                onWrite?.(value);
            },
            systemDark: () => systemDark,
            applyTheme: theme => painted.push(theme),
            onSystemChange: listener => {
                systemListeners.add(listener);
                return () => systemListeners.delete(listener);
            },
            onStorageChange: listener => {
                storageListeners.add(listener);
                return () => storageListeners.delete(listener);
            },
        },
        changeSystem(value) {
            systemDark = value;
            [...systemListeners].forEach(listener => listener());
        },
        storageEvent(value) {
            preference = value;
            [...storageListeners].forEach(listener => listener(value));
        },
    };
}

test('blocked browser storage still allows a manual theme throughout the visit', () => {
    const tab = browser({ dark: true, blocked: true }), controller = new ThemeController();
    const disconnect = controller.connect(tab.environment);
    assert.equal(controller.getSnapshot().resolvedTheme, 'dark');
    assert.doesNotThrow(() => controller.setTheme('light'));
    tab.changeSystem(true);
    assert.deepEqual(controller.getSnapshot(), { theme: 'light', resolvedTheme: 'light' });
    assert.equal(tab.painted.at(-1), 'light');
    assert.equal(tab.systemListeners.size, 0);
    assert.doesNotThrow(() => controller.setTheme('dark'));
    assert.equal(controller.getSnapshot().resolvedTheme, 'dark');
    disconnect();
});

test('an explicit saved choice takes precedence over the system and persists a new choice', () => {
    const tab = browser({ saved: 'light', dark: true }), controller = new ThemeController();
    const disconnect = controller.connect(tab.environment);
    assert.deepEqual(controller.getSnapshot(), { theme: 'light', resolvedTheme: 'light' });
    assert.equal(tab.systemListeners.size, 0);
    tab.changeSystem(false);
    controller.setTheme('dark');
    tab.changeSystem(true);
    tab.changeSystem(false);
    assert.deepEqual(controller.getSnapshot(), { theme: 'dark', resolvedTheme: 'dark' });
    assert.deepEqual(tab.written, ['dark']);
    assert.equal(tab.systemListeners.size, 0);
    disconnect();
});

test('system following starts only when selected and releases browser listeners on cleanup', () => {
    const tab = browser({ saved: 'dark', dark: false }), controller = new ThemeController();
    const disconnect = controller.connect(tab.environment);
    assert.equal(tab.systemListeners.size, 0);
    controller.setTheme('system');
    assert.equal(tab.systemListeners.size, 1);
    assert.equal(controller.getSnapshot().resolvedTheme, 'light');
    tab.changeSystem(true);
    assert.equal(controller.getSnapshot().resolvedTheme, 'dark');
    const delayedSystem = [...tab.systemListeners][0], delayedStorage = [...tab.storageListeners][0];
    disconnect();
    assert.equal(tab.systemListeners.size, 0);
    assert.equal(tab.storageListeners.size, 0);

    const replacement = browser({ saved: 'light', dark: true });
    const stopReplacement = controller.connect(replacement.environment);
    const state = controller.getSnapshot(), painted = replacement.painted.length;
    delayedSystem();
    delayedStorage('dark');
    assert.equal(controller.getSnapshot(), state);
    assert.equal(replacement.painted.length, painted);
    stopReplacement();
    assert.equal(replacement.storageListeners.size, 0);
});

test('corrupt stored preferences fall back to the system without propagating their contents', () => {
    for (const saved of [undefined, null, '', 'DARK', 'unknown', {}, '<script>throw new Error()</script>']) {
        const tab = browser({ saved, dark: true }), controller = new ThemeController();
        const disconnect = controller.connect(tab.environment);
        assert.deepEqual(controller.getSnapshot(), { theme: 'system', resolvedTheme: 'dark' });
        assert.deepEqual(tab.painted, ['dark']);
        assert.deepEqual(tab.written, []);
        tab.changeSystem(false);
        assert.equal(controller.getSnapshot().resolvedTheme, 'light');
        disconnect();
    }
});

test('another tab synchronizes an explicit choice without writing it back; clearing storage restores system mode', () => {
    const controllerA = new ThemeController(), controllerB = new ThemeController();
    const tabB = browser({ dark: true });
    const tabA = browser({ onWrite: value => tabB.storageEvent(value) });
    const disconnectA = controllerA.connect(tabA.environment), disconnectB = controllerB.connect(tabB.environment);
    assert.equal(controllerA.getSnapshot().resolvedTheme, 'light');
    assert.equal(controllerB.getSnapshot().resolvedTheme, 'dark');
    controllerA.setTheme('light');
    assert.deepEqual(controllerB.getSnapshot(), { theme: 'light', resolvedTheme: 'light' });
    assert.deepEqual(tabA.written, ['light']);
    assert.deepEqual(tabB.written, []);
    assert.equal(tabB.systemListeners.size, 0);
    tabB.changeSystem(true);
    assert.equal(controllerB.getSnapshot().resolvedTheme, 'light');
    tabB.storageEvent(null);
    assert.deepEqual(controllerB.getSnapshot(), { theme: 'system', resolvedTheme: 'dark' });
    assert.equal(tabB.systemListeners.size, 1);
    disconnectA(); disconnectB();
});

test('the parser-time script paints the same theme the hydrated controller subsequently adopts', () => {
    const cases = [
        { saved: 'dark', dark: false, expected: 'dark' },
        { saved: 'light', dark: true, expected: 'light' },
        { saved: 'system', dark: true, expected: 'dark' },
        { saved: null, dark: false, expected: 'light' },
        { saved: 'globalThis.executed = true', dark: true, expected: 'dark' },
        { saved: 'light', dark: true, blocked: true, expected: 'dark' },
    ];
    for (const scenario of cases) {
        const attributes = {}, element = { style: {}, setAttribute: (name, value) => { attributes[name] = value; } };
        const context = {
            document: { documentElement: element },
            localStorage: { getItem: key => {
                assert.equal(key, THEME_STORAGE_KEY);
                if (scenario.blocked) throw new Error('storage blocked');
                return scenario.saved;
            } },
            window: { matchMedia: query => {
                assert.equal(query, '(prefers-color-scheme: dark)');
                return { matches: scenario.dark };
            } },
        };
        vm.runInNewContext(THEME_BOOTSTRAP_SCRIPT, context);
        assert.equal(attributes['data-theme'], scenario.expected);
        assert.equal(element.style.colorScheme, scenario.expected);
        assert.equal(context.executed, undefined);

        const tab = browser(scenario), controller = new ThemeController();
        const disconnect = controller.connect(tab.environment);
        assert.equal(controller.getSnapshot().resolvedTheme, attributes['data-theme']);
        assert.deepEqual(tab.painted, [scenario.expected]);
        // SSR's stable snapshot remains independent of each browser's client-only preference.
        assert.deepEqual(INITIAL_THEME, { theme: 'system', resolvedTheme: 'light' });
        disconnect();
    }
});
