const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { validateRequest } = require('../electron/policy.cjs');

const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/announcements.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject, Date, Error });

test('programación de anuncios usa hora de Perú independientemente del Windows local', () => {
  assert.equal(exportsObject.peruDateInput('2026-10-09T01:08:00Z'), '2026-10-08T20:08');
  assert.equal(exportsObject.peruDateIso('2026-10-08T20:08'), '2026-10-09T01:08:00.000Z');
  assert.equal(exportsObject.peruDateIso(''), null);
  assert.equal(exportsObject.peruDateInput(null), '');
  assert.throws(() => exportsObject.peruDateIso('malformed'));
});

test('escritorio autoriza solo CRUD anuncios y moderación concretos', () => {
  for (const route of ['/announcements/manage', '/announcements/traffic-moderation', '/navigation/traffic/incidents']) assert.equal(validateRequest({ route }).method, 'GET');
  assert.equal(validateRequest({ route: '/announcements/manage', method: 'POST', body: '{}' }).method, 'POST');
  assert.equal(validateRequest({ route: '/announcements/manage/1', method: 'PATCH', body: '{}' }).method, 'PATCH');
  assert.equal(validateRequest({ route: '/announcements/manage/1', method: 'DELETE' }).method, 'DELETE');
  assert.equal(validateRequest({ route: '/announcements/traffic-moderation', method: 'POST', body: '{}' }).method, 'POST');
  for (const route of ['/announcements/manage/0', '/announcements/manage/all', '/announcements/traffic-moderation/1', '/navigation/traffic/incidents?key=secret', '/navigation/traffic']) assert.throws(() => validateRequest({ route, method: 'DELETE' }));
});

test('snapshot de tráfico descarta claves del proveedor y otros datos', () => {
  const result = exportsObject.trafficSnapshot({ titulo: 'Cierre', tipo: 'Cierre', descripcion: 'Vía cerrada', latitud: -14.06, longitud: -75.72, inicio: null, fin: null, apiKey: 'never-store', usuario: 'private' });
  assert.equal('apiKey' in result, false); assert.equal('usuario' in result, false);
  assert.equal(result.titulo, 'Cierre');
});
