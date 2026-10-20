import assert from 'node:assert/strict';
import path from 'node:path';

// Called by ui-smoke.mjs --offline-notices: real Vite/AppContent/React/Mapbox in
// Chromium. Connectivity, denied GPS and unavailable HTTP/style are fixtures;
// no production calls, provider outage or Android compatibility are claimed.
export async function checkOfflineMapNotices(page, folder, driver) {
  const checks = [];
  const rail = page.locator('.map-render-status');
  const notice = title => rail.locator('.map-status-notice').filter({ has: page.locator('summary').filter({ hasText: title }) });
  const assertFront = async element => assert.ok(await element.evaluate(item => {
    const box = item.getBoundingClientRect(), top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top !== null && item.contains(top);
  }), 'El control o título debe permanecer visible, sin recortes ni otra tarjeta encima');
  for (const title of ['Sin conexión', 'GPS no disponible', 'Mapa no disponible', 'Riesgo no disponible']) await notice(title).waitFor();
  assert.equal(await rail.locator('.map-status-notice[open]').count(), 0);
  assert.equal(await rail.locator('summary').filter({ hasText: 'Alertas sin actualizar' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Reintentar alertas', exact: true }).isVisible(), false);
  checks.push('Arranque offline: cuatro diagnósticos contraídos y ningún aviso API duplicado');

  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light';
    const themeButton = page.getByRole('button', { name: dark ? 'Modo oscuro' : 'Modo claro', exact: true });
    if (await themeButton.count()) await themeButton.click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.evaluate(() => { document.querySelectorAll('.map-status-notice').forEach(item => { item.open = false; }); });
    const layout = await rail.evaluate(element => {
      const box = element.getBoundingClientRect();
      const intersects = other => { const b = other.getBoundingClientRect(); return Math.min(box.right, b.right) > Math.max(box.left, b.left) && Math.min(box.bottom, b.bottom) > Math.max(box.top, b.top); };
      return { height: box.height, width: box.width, clipped: element.scrollHeight > element.clientHeight + 1, overflow: document.documentElement.scrollWidth > innerWidth + 1,
        legendOverlap: intersects(document.querySelector('.map-fixed-legend')),
        controlsOverlap: intersects(document.querySelector('.map-floating-controls')),
        sheetOverlap: intersects(document.querySelector('.map-bottom-sheet')) };
    });
    assert.ok(layout.height <= 140 && layout.width <= 130 && !layout.clipped, `La columna de avisos debe ser compacta y mostrar todos sus títulos: ${JSON.stringify(layout)}`);
    assert.equal(layout.overflow, false); assert.equal(layout.legendOverlap, false); assert.equal(layout.controlsOverlap, false); assert.equal(layout.sheetOverlap, false);
    await page.screenshot({ path: path.join(folder, `offline-${theme}-collapsed.png`) });
    checks.push(`360×640 ${theme}: avisos compactos sin desbordar ni tapar leyenda, controles o rutas`);

    await notice('Sin conexión').locator('summary').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Reintentar alertas', exact: true }).waitFor();
    await assertFront(notice('Sin conexión').locator('summary'));
    await assertFront(page.getByRole('button', { name: 'Reintentar alertas', exact: true }));
    const incidentsBefore = driver.counts().incidents;
    driver.failIncidents(false);
    await page.getByRole('button', { name: 'Reintentar alertas', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.map-status-notice[open] small')].some(item => item.textContent.includes('Última actualización:')));
    assert.ok(driver.counts().incidents > incidentsBefore);
    await page.screenshot({ path: path.join(folder, `offline-${theme}-expanded.png`) });
    await assertFront(notice('Sin conexión').locator('summary'));
    await notice('Sin conexión').locator('summary').click();
    assert.equal(await rail.getByText(/Última actualización:/).isVisible(), false);
    checks.push(`${theme}: expansión por teclado, reintento real y timestamp sólo dentro del detalle`);

    await notice('GPS no disponible').locator('summary').click();
    const gpsBefore = await page.evaluate(() => window.__uiGPSRetries);
    await page.getByRole('button', { name: 'Reintentar GPS', exact: true }).click();
    await page.waitForFunction(before => window.__uiGPSRetries > before, gpsBefore);
    await notice('GPS no disponible').locator('summary').click();
    const mapBefore = driver.counts().map;
    await notice('Mapa no disponible').locator('summary').click();
    await page.getByRole('button', { name: 'Reintentar mapa', exact: true }).click();
    await notice('Mapa no disponible').waitFor();
    assert.ok(driver.counts().map > mapBefore);
    // The rebuilt error is a fresh disclosure and returns to compact form.
    assert.equal(await notice('Mapa no disponible').getAttribute('open'), null);
    await notice('Riesgo no disponible').locator('summary').click();
    const roadsBefore = driver.counts().roads;
    const roadResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/navigation/roads/risk');
    await page.getByRole('button', { name: 'Reintentar calles', exact: true }).click();
    await roadResponse;
    assert.ok(driver.counts().roads > roadsBefore);
    await notice('Riesgo no disponible').locator('summary').click();
    checks.push(`${theme}: reintentos GPS, mapa y riesgo conservan sus controladores`);
  }
  await page.getByRole('button', { name: 'Mostrar navegación compacta', exact: true }).click();
  for (const title of ['Sin conexión', 'GPS no disponible', 'Mapa no disponible', 'Riesgo no disponible']) await assertFront(notice(title).locator('summary'));
  await page.screenshot({ path: path.join(folder, 'offline-dark-sheet-compact.png') });
  await notice('Sin conexión').locator('summary').click();
  await assertFront(notice('Sin conexión').locator('summary'));
  await assertFront(page.getByRole('button', { name: 'Reintentar alertas', exact: true }));
  await notice('Sin conexión').locator('summary').click();
  await page.getByRole('button', { name: 'Ampliar rutas y condiciones', exact: true }).click();
  checks.push('Sheet compacto y expandido conservan todos los títulos y reintentos visibles');
  driver.failIncidents(true);
  await page.evaluate(() => { window.__uiOnline = true; window.dispatchEvent(new Event('online')); });
  await notice('Alertas sin actualizar').waitFor();
  assert.equal(await rail.locator('summary').filter({ hasText: 'Sin conexión' }).count(), 0);
  assert.equal(await notice('Alertas sin actualizar').getAttribute('open'), null);
  await notice('Alertas sin actualizar').locator('summary').click();
  await page.getByRole('button', { name: 'Reintentar alertas', exact: true }).waitFor();
  assert.ok(await rail.getByText(/Última actualización:/).isVisible());
  driver.failIncidents(false); await page.getByRole('button', { name: 'Reintentar alertas', exact: true }).click();
  await notice('Alertas sin actualizar').waitFor({ state: 'detached' });
  checks.push('Error API online accesible y reintento exitoso elimina sólo ese aviso');
  return checks;
}
