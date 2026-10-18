import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReportCameraRecovery } from '../src/services/cameraRecovery';

const photo = { webPath: 'https://localhost/_capacitor_file_/data/user/0/com.civigo.app/cache/photo.jpg', format: 'jpeg' };
function fixture() {
  const data = new Map<string, string>();
  let time = 1000000;
  const storage = { get: async (key: string) => data.get(key) || null, set: async (key: string, value: string) => { data.set(key, value); }, remove: async (key: string) => { data.delete(key); } };
  return { store: new ReportCameraRecovery(storage, 'https://localhost', () => time), data, advance: (ms: number) => { time += ms; } };
}

test('a restored camera result is offered only to its original account and consumed once', async () => {
  const { store } = fixture();
  const nonce = await store.begin(11);
  await store.restore({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: photo }, await store.snapshot());
  assert.equal(await store.read(12), null);
  const recovered = await store.read(11);
  assert.equal(recovered?.nonce, nonce); assert.equal(recovered?.webPath, photo.webPath);
  await store.consume(12, nonce); assert.ok(await store.read(11));
  await store.consume(11, nonce); assert.equal(await store.read(11), null);
});

test('restored results need a live capture marker and local non-executable photo URL', async () => {
  for (const data of [{ ...photo, webPath: 'https://evil.test/p.jpg' }, { ...photo, webPath: 'https://localhost/api/private' }, { ...photo, format: 'svg' }, { ...photo, webPath: photo.webPath + '?token=x' }]) {
    const { store } = fixture(); await store.begin(11);
    await store.restore({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data }, await store.snapshot());
    assert.equal(await store.read(11), null);
  }
  const { store } = fixture();
  await store.restore({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: photo }, null);
  assert.equal(await store.read(11), null);
});

test('normal completion, logout and expired activity results cannot resurrect photographs', async () => {
  const { store, advance } = fixture();
  const nonce = await store.begin(11); await store.finish(nonce);
  await store.restore({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: photo }, nonce);
  assert.equal(await store.read(11), null);
  const expiredNonce = await store.begin(11); advance(16 * 60 * 1000);
  await store.restore({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: photo }, expiredNonce);
  assert.equal(await store.read(11), null);
  const discardedNonce = await store.begin(11); await store.discard(11);
  await store.restore({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: photo }, discardedNonce);
  assert.equal(await store.read(11), null);
});

test('a late activity result cannot attach an earlier account photo to a new capture', async () => {
  const { store } = fixture();
  await store.begin(11);
  const startupNonce = await store.snapshot();
  const laterNonce = await store.begin(12);
  await store.restore({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: photo }, startupNonce);
  assert.equal(await store.read(12), null);
  assert.equal(await store.snapshot(), laterNonce);
});
