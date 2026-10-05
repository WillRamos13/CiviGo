import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react(), tailwind()], base: './',
  resolve: { alias: { '@': path.resolve(directory, 'src'), 'next/link': path.resolve(directory, 'src/components/Link.tsx') } },
  build: { outDir: 'dist', sourcemap: false },
});
