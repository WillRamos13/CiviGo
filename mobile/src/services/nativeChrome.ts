import { Capacitor, registerPlugin } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { Theme } from './theme';

interface SystemChrome { setTheme(options: { dark: boolean }): Promise<void>; }
interface ChromeDriver {
  isNative(): boolean;
  platform(): string;
  android: SystemChrome;
  statusBar: { setBackgroundColor(options: { color: string }): Promise<void>; setStyle(options: { style: Style }): Promise<void> };
}
const SystemChrome = registerPlugin<SystemChrome>('SystemChrome');

export function createNativeChromeUpdater(driver: ChromeDriver) {
  return async (theme: Theme): Promise<void> => {
    if (!driver.isNative()) return;
    if (driver.platform() === 'android') {
      // The native operation updates both theme attributes and window flags atomically.
      await driver.android.setTheme({ dark: theme === 'dark' });
      // Keep StatusBar's remembered style coherent when it handles configuration changes.
      try { await driver.statusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }); }
      catch { /* The native attribute/window operation already established contrast. */ }
      return;
    }
    try { await driver.statusBar.setBackgroundColor({ color: theme === 'dark' ? '#091320' : '#f5f8fe' }); }
    catch { /* Platforms that own the bar background can still apply legible text. */ }
    await driver.statusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
  };
}

export const applyNativeChromeTheme = createNativeChromeUpdater({
  isNative: () => Capacitor.isNativePlatform(), platform: () => Capacitor.getPlatform(), android: SystemChrome, statusBar: StatusBar,
});
