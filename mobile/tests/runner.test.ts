import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function fixture(name: string) {
  return spawnSync(process.execPath, ['tests/run.js', `tests/fixtures/${name}.fixture.ts`], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, CIVIGO_TEST_TIMEOUT_MS: '5000' },
  });
}
test('el ejecutor devuelve error cuando una aserción falla', () => {
  const result = fixture('failed');
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stdout, /fallo esperado/);
});
test('el ejecutor falla con una prueba sin completar', () => {
  const result = fixture('incomplete');
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stdout, /cancelled|pending|Promise resolution|did not finish/i);
});
test('el ejecutor espera pruebas que tardan más de 800ms', () => {
  const start = Date.now();
  const result = fixture('delayed');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(Date.now() - start >= 1100);
});
