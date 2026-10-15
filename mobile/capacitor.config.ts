import type { CapacitorConfig } from '@capacitor/cli';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const nativePlugins = [
  '@capacitor/app', '@capacitor/camera', '@capacitor/geolocation', '@capacitor/haptics',
  '@capacitor/network', '@capacitor/preferences', '@capacitor/splash-screen', '@capacitor/status-bar',
];
// The plugin initializes Firebase at application startup. Without native project
// resources, exclude it so the rest of the app can run and report the missing setup.
if (existsSync(resolve('android/app/google-services.json'))) nativePlugins.push('@capacitor-firebase/authentication');

const config: CapacitorConfig = {
  appId: 'com.civigo.app',
  appName: 'CiviGo',
  webDir: 'dist',
  // Capacitor's native HTTP debug logs can include Set-Cookie headers.
  loggingBehavior: 'none',
  android: { includePlugins: nativePlugins },
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorCookies: {
      // Native HTTP manages the HttpOnly cookie; do not patch document.cookie.
      enabled: false,
    },
    FirebaseAuthentication: {
      providers: ['google.com'],
      skipNativeAuth: false,
    },
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: '#1554d8',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1554d8',
    },
  },
};

export default config;
