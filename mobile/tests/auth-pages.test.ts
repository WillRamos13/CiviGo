import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = [
  process.env.CIVIGO_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  chromium.executablePath(),
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

test('authentication pages synchronize the provider after Back without navigating a disposed page', {
  skip: !executablePath && 'A local Chromium browser is required for these isolated UI regressions.',
  timeout: 15000,
}, async context => {
  // Bundle the real pages and provider in memory. Every browser request is
  // intercepted below; this harness has no provider or production access.
  const bundled = await build({
    stdin: {
      resolveDir: process.cwd(), sourcefile: 'auth-pages-harness.tsx', loader: 'tsx',
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { AuthProvider, useAuth } from './src/hooks/useAuth';
        import { LoginPage } from './src/pages/LoginPage';
        import { RegisterPage } from './src/pages/RegisterPage';
        window.authNavigations = [];
        function Harness() {
          const [visible, setVisible] = useState(true);
          const { usuario, loading } = useAuth();
          const back = () => setVisible(false);
          const success = () => window.authNavigations.push('success');
          const register = new URLSearchParams(location.search).get('mode') === 'register';
          return <>
            <output id="identity" data-loading={loading} data-blocked={usuario?.bloqueado === true}>{usuario?.id ?? 'guest'}</output>
            {!visible ? <div id="after-back">Perfil</div> : register
              ? <RegisterPage onSuccess={success} onBack={back} onGoLogin={back} />
              : <LoginPage onSuccess={success} onBack={back} onGoRegister={back} onGoForgot={back} />}
          </>;
        }
        createRoot(document.getElementById('root')).render(<AuthProvider><Harness /></AuthProvider>);
      `,
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'error',
    define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: '/api' }), 'process.env.NODE_ENV': '"test"' },
  });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const mode of ['login', 'register', 'blocked']) {
      await context.test(mode, async () => {
        const page = await browser.newPage();
        page.setDefaultTimeout(4000);
        let finishAuthentication!: () => void;
        const release = new Promise<void>(resolve => { finishAuthentication = resolve; });
        let requested!: () => void;
        const authenticationStarted = new Promise<void>(resolve => { requested = resolve; });
        let signedIn = false;
        const user = { id: 82, nickname: 'Ciudadano', correo: 'ciudadano@gmail.com', rol: 'USUARIO', correoVerificado: true, bloqueado: mode === 'blocked' };
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== 'http://localhost:47823') return route.abort();
            if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/bundle.js"></script>' });
            if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0].text });
            if (url.pathname === '/api/users/login' || url.pathname === '/api/users/register') {
              requested(); await release; signedIn = true;
              return route.fulfill({ status: mode === 'blocked' ? 403 : 200, json: mode === 'blocked' ? { error: 'Cuenta bloqueada.', code: 'ACCOUNT_BLOCKED', usuario: user } : { usuario: user } });
            }
            if (url.pathname === '/api/users/me') return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { usuario: user } : { error: 'Inicia sesión.' } });
            return route.abort();
          });
          await page.goto(`http://localhost:47823/?mode=${mode}`);
          await page.waitForFunction(() => document.querySelector('#identity')?.getAttribute('data-loading') === 'false');
          await page.getByLabel(mode === 'register' ? 'Correo Gmail (@gmail.com)' : 'Correo electrónico', { exact: true }).fill(user.correo);
          await page.getByLabel(mode === 'register' ? 'Contraseña (mínimo 10 caracteres)' : 'Contraseña', { exact: true }).fill('fixture-password-123');
          if (mode === 'register') {
            await page.getByLabel('Nombres', { exact: true }).fill('Nombre');
            await page.getByLabel('Apellidos', { exact: true }).fill('Apellido');
            await page.getByLabel('Nickname público', { exact: true }).fill(user.nickname);
            await page.getByLabel('Teléfono', { exact: false }).fill('+51999999999');
            await page.getByLabel('Fecha de nacimiento', { exact: true }).fill('2000-01-01');
            await page.getByRole('checkbox').check();
          }
          await page.getByRole('button', { name: mode === 'register' ? 'Crear mi cuenta' : 'Iniciar sesión', exact: true }).click();
          await authenticationStarted;
          await page.getByRole('button', { name: 'Volver', exact: true }).click();
          await page.locator('#after-back').waitFor();
          finishAuthentication();
          await page.waitForFunction(() => document.querySelector('#identity')?.textContent === '82', undefined, { timeout: 4000 });
          assert.equal(await page.locator('#identity').getAttribute('data-blocked'), String(mode === 'blocked'));
          assert.deepEqual(await page.evaluate(() => (window as unknown as { authNavigations: string[] }).authNavigations), []);
          assert.deepEqual(errors, []);
        } finally { finishAuthentication(); await page.close(); }
      });
    }
  } finally { await browser.close(); }
});
