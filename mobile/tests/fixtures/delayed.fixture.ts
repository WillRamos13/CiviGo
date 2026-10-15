import { test } from 'node:test';
import assert from 'node:assert/strict';
test('espera un resultado asíncrono real', async () => {
  const value = await new Promise(resolve => setTimeout(() => resolve('completado'), 1100));
  assert.equal(value, 'completado');
});
