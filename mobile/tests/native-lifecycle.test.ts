import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscribeAsync } from '../src/services/native-lifecycle';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('registro nativo tardío se libera después del desmontaje', async () => {
  let resolve!: (cleanup: () => void) => void;
  let released = 0;
  const stop = subscribeAsync(() => new Promise(r => { resolve = r; }));
  await tick();
  stop();
  resolve(() => { released++; });
  await tick();
  stop();
  assert.equal(released, 1);
});
test('no entrega callbacks nativos después del cierre y libera una sola vez', async () => {
  let active!: () => boolean;
  let removed = 0;
  const stop = subscribeAsync(async isActive => {
    active = isActive;
    return () => { removed++; };
  });
  await tick();
  assert.equal(active(), true);
  stop(); stop();
  assert.equal(active(), false);
  assert.equal(removed, 1);
});
test('errores de permisos y de registro no quedan como promesas sin manejar', async () => {
  const errors: unknown[] = [];
  subscribeAsync(async () => { throw new Error('GPS denegado'); }, error => errors.push(error));
  await tick();
  assert.equal((errors[0] as Error).message, 'GPS denegado');
  const stop = subscribeAsync(async () => () => Promise.reject(new Error('cierre tardío')));
  await tick(); stop(); await tick();
});
