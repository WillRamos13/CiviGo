import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { Style } from '@capacitor/status-bar';
import { createNativeChromeUpdater } from '../src/services/nativeChrome';

test('Android updates theme attributes first and then synchronizes StatusBar remembered contrast', async () => {
  const calls: unknown[] = [];
  const update = createNativeChromeUpdater({
    isNative: () => true, platform: () => 'android', android: { setTheme: async options => { calls.push(options); } },
    statusBar: { setBackgroundColor: async () => { throw new Error('Android must update attributes and live window together'); }, setStyle: async options => { calls.push(options); if (options.style === Style.Dark) throw new Error('Optional StatusBar unsupported'); } },
  });
  await update('light'); await update('dark');
  assert.deepEqual(calls, [{ dark: false }, { style: Style.Light }, { dark: true }, { style: Style.Dark }]);
});

test('other native platforms set background before text contrast even when the background is unsupported', async () => {
  const calls: unknown[] = [];
  const update = createNativeChromeUpdater({
    isNative: () => true, platform: () => 'ios', android: { setTheme: async () => { throw new Error('Android-only plugin'); } },
    statusBar: { setBackgroundColor: async options => { calls.push(options); throw new Error('Platform owns background'); }, setStyle: async options => { calls.push(options); } },
  });
  await update('light'); await update('dark');
  assert.deepEqual(calls, [{ color: '#f5f8fe' }, { style: Style.Light }, { color: '#091320' }, { style: Style.Dark }]);
});

test('web themes make no native call and a native failure remains a handled operation for the caller', async () => {
  let calls = 0;
  const driver = {
    isNative: () => false, platform: () => 'android', android: { setTheme: async () => { calls++; throw new Error('Unavailable Activity'); } },
    statusBar: { setBackgroundColor: async () => { calls++; }, setStyle: async () => { calls++; } },
  };
  await createNativeChromeUpdater(driver)('dark'); assert.equal(calls, 0);
  driver.isNative = () => true;
  await assert.rejects(createNativeChromeUpdater(driver)('light'), /Unavailable Activity/);
  assert.equal(calls, 1);
});

const executablePath = [process.env.CIVIGO_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', chromium.executablePath()].find((path): path is string => Boolean(path && existsSync(path)));
test('real ThemeProvider serializes the latest theme, pauses updates in background and cleans focus listeners without timers', { skip: !executablePath && 'Requires local Chromium', timeout: 15000 }, async () => {
  const replacements: Record<string, string> = {
    '@capacitor/core': `export const Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }; export const registerPlugin = () => new Proxy({}, { get: (_, key) => (...args) => window.chromePlugin[key](...args) });`,
    '@capacitor/status-bar': `export const Style = { Dark:'DARK',Light:'LIGHT' }; export const StatusBar = { setBackgroundColor: async () => { throw new Error('Must use attribute plugin on Android'); }, setStyle: async options => {window.statusStyles.push(options);} };`,
    'services/native': `export const StorageService = { get: async () => null, set: async () => {} };`,
    './useAppActivity': `import { useSyncExternalStore } from 'react'; const subscribers=new Set(); window.setForeground = active => { window.foreground = active; for(const listener of subscribers) listener(); }; export const useAppActivity=()=>useSyncExternalStore(listener=>{subscribers.add(listener);return()=>subscribers.delete(listener)},()=>window.foreground);`,
  };
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { ThemeProvider,useTheme } from './src/hooks/useTheme';
      window.foreground=true;window.calls=[];window.statusStyles=[];window.pending=[];window.hold=true;
      window.chromePlugin={setTheme:options=>{window.calls.push(options);return window.hold?new Promise(resolve=>window.pending.push(resolve)):Promise.resolve();}};
      function Controls(){const {theme,toggleTheme}=useTheme();return <button onClick={toggleTheme}>Toggle {theme}</button>;}
      const root=createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();root.render(<ThemeProvider><Controls/></ThemeProvider>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'error',
    plugins: [{ name: 'system-chrome-fixture', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => { const key = Object.keys(replacements).find(key => args.path.endsWith(key)); if (key) return { path: key, namespace: 'fixture' }; });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: replacements[args.path], loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ colorScheme: 'light' }); page.setDefaultTimeout(3000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  try {
    await page.waitForFunction(() => (window as any).calls.length === 1);
    assert.deepEqual(await page.evaluate(() => (window as any).calls), [{ dark: false }]);
    await page.getByRole('button', { name: 'Toggle light' }).click();
    await page.getByRole('button', { name: 'Toggle dark' }).waitFor();
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); (window as any).setForeground(false); });
    await page.waitForTimeout(25);
    await page.evaluate(() => { (window as any).hold=false; (window as any).pending[0](); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => (window as any).calls.length), 1, 'queued themes and focus events are discarded after background');
    await page.evaluate(() => (window as any).setForeground(true));
    await page.waitForFunction(() => (window as any).calls.length === 2);
    assert.deepEqual(await page.evaluate(() => (window as any).calls[1]), { dark: true });
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    await page.waitForTimeout(2100);
    assert.equal(await page.evaluate(() => (window as any).calls.length), 2, 'no splash timeout or polling reapplication');
    await page.getByRole('button', { name: 'Toggle dark' }).click();
    await page.waitForFunction(() => (window as any).calls.length === 3);
    assert.deepEqual(await page.evaluate(() => (window as any).calls[2]), { dark: false });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => (window as any).calls.length === 4);
    await page.evaluate(() => { (window as any).unmount(); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(25); assert.equal(await page.evaluate(() => (window as any).calls.length), 4);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
