import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readAndroidFirebaseProjectId } from './android-firebase-config';

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    // Native authentication reads its credentials from Android resources. The
    // web bundle receives only this public project ID, never the native JSON.
    'import.meta.env.CIVIGO_ANDROID_FIREBASE_PROJECT_ID': JSON.stringify(readAndroidFirebaseProjectId(path.resolve(__dirname, 'android/app/google-services.json'), 'com.civigo.app')),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
        secure: true,
      },
      '/uploads': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/mapbox-gl')) {
            return 'mapbox-gl';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/@capacitor')) {
            return 'capacitor-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide-vendor';
          }
        },
      },
    },
  },
});
