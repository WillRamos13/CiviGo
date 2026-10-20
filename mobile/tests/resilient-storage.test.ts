import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import path from 'node:path';
import { ResilientStorage, storageJournalKey, type PreferenceDriver, type JournalStorage } from '../src/services/resilientStorage';
import { SessionRevocation } from '../src/services/auth';
import { ActiveTripController } from '../src/services/activeTrip';
import type { Ruta } from '../src/types';

function fixture() {
  const native = new Map<string, string>(), web = new Map<string, string>();
  const applied: string[] = [];
  const failures = new Map<string, number>();
  const blocked = new Map<string, { entered: () => void; wait: Promise<void> }>();
  let failJournalWrite = false, failJournalRead = false, failLegacyRemove = false;
  function fail(operation: string) {
    const remaining = failures.get(operation) ?? 0;
    if (remaining) { failures.set(operation, remaining - 1); throw new Error('Fixture native unavailable'); }
  }
  async function before(operation: string) {
    const gate = blocked.get(operation);
    if (gate) { blocked.delete(operation); gate.entered(); await gate.wait; }
    fail(operation);
  }
  const createDriver = (): PreferenceDriver => ({
    get: async ({ key }) => { await before('get:' + key); return { value: native.get(key) ?? null }; },
    set: async ({ key, value }) => { await before('set:' + key); native.set(key, value); applied.push(value); },
    remove: async ({ key }) => { await before('remove:' + key); native.delete(key); },
  });
  const driver = createDriver();
  const journal: JournalStorage = {
    getItem: key => { if (failJournalRead) throw new Error('Fixture SecurityError'); return web.get(key) ?? null; },
    setItem: (key, value) => { if (failJournalWrite) throw new Error('Fixture quota'); web.set(key, value); },
    removeItem: key => { if (failLegacyRemove && !key.startsWith('civigo:storage-journal:')) throw new Error('Fixture cleanup failure'); web.delete(key); },
  };
  return {
    native, web, failures, journal, driver, applied,
    storage: new ResilientStorage(driver, () => journal),
    restart: () => new ResilientStorage(createDriver(), () => journal),
    quota: (fail: boolean) => { failJournalWrite = fail; },
    inaccessible: (fail: boolean) => { failJournalRead = fail; },
    failCleanup: (fail: boolean) => { failLegacyRemove = fail; },
    block(operation: string) {
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      blocked.set(operation, { entered, wait: new Promise<void>(resolve => { release = resolve; }) });
      return { started, release };
    },
  };
}
const tripKey = 'civigo:active-trip:v1:user:42';
const route: Ruta = { id: 'storage-fixture', nombre: 'Recorrido', tipo: 'rapida', distancia: 1000, duracion: 600,
  geometria: { type: 'LineString', coordinates: [[-75.72, -14.06], [-75.73, -14.07]] },
  destino: { latitud: -14.07, longitud: -75.73 }, modo: 'driving', advertencias: [], puntosRiesgo: 0, nivelRiesgo: 0 };

test('un logout con set nativo fallido se recupera tras nueva instancia y revoca la cookie antes de autenticar', async () => {
  const f = fixture(), key = 'civigo:logout-pending';
  f.native.set('civigo:offline-account', '{"id":42,"nickname":"Fixture"}');
  f.failures.set('set:' + key, 1);
  const before = new SessionRevocation(f.storage, async () => {}, () => false);
  await before.markLogout();
  assert.equal(f.native.has(key), false);
  assert.equal(f.web.has(storageJournalKey(key)), true);
  assert.equal(f.native.has('civigo:offline-account'), false);
  let revocations = 0;
  const after = new SessionRevocation(f.restart(), async () => { revocations++; }, () => true);
  assert.equal(await after.hasPending(), true);
  await after.authenticate(async () => { assert.equal(revocations, 1); });
  assert.equal(await after.hasPending(), false);
  assert.equal(f.native.has(key), false);
  assert.equal(f.web.has(storageJournalKey(key)), false);
  assert.equal(f.web.has(key), false);
});

test('eliminar un viaje ante fallo nativo persiste tombstone y no restaura el viaje al reiniciar', async () => {
  const f = fixture(), first = new ActiveTripController(f.storage);
  first.setOwner(42); await first.save(route, 350, 900000, 1000000);
  f.web.set(tripKey, f.native.get(tripKey)!); // Old alternate cache must also be retired.
  f.failures.set('remove:' + tripKey, 2);
  await first.clear();
  assert.equal(f.native.has(tripKey), true);
  assert.equal(JSON.parse(f.web.get(storageJournalKey(tripKey))!).operation, 'remove');
  const second = new ActiveTripController(f.restart()); second.setOwner(42);
  assert.equal(await second.load(1000100), null);
  assert.equal(f.native.has(tripKey), true);
  assert.equal(f.web.has(storageJournalKey(tripKey)), true);
  const third = new ActiveTripController(f.restart()); third.setOwner(42);
  assert.equal(await third.load(1000200), null);
  assert.equal(f.native.has(tripKey), false);
  assert.equal(f.web.has(tripKey), false);
  assert.equal(f.web.has(storageJournalKey(tripKey)), false);
});

test('el journal se recupera en un proceso JS nuevo sin cola ni reintentos en memoria', async () => {
  const f = fixture(); f.native.set(tripKey, 'private-fixture');
  f.failures.set('remove:' + tripKey, 1); await f.storage.remove(tripKey);
  const compiled = await build({ entryPoints: [path.resolve('src/services/resilientStorage.ts')], bundle: true, write: false,
    platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
  const source = Buffer.from(compiled.outputFiles[0].text).toString('base64');
  const code = `import { ResilientStorage, storageJournalKey } from 'data:text/javascript;base64,${source}';
    const state = JSON.parse(process.env.CIVIGO_FIXTURE_STORES);
    const native = new Map(state.native), web = new Map(state.web);
    let unavailable = true;
    const driver = { get: async({key})=>({value:native.get(key)??null}), set:async({key,value})=>{native.set(key,value)},
      remove:async({key})=>{if(unavailable)throw Error('fixture');native.delete(key)} };
    const store = new ResilientStorage(driver,()=>({getItem:key=>web.get(key)??null,setItem:(key,value)=>web.set(key,value),removeItem:key=>web.delete(key)}));
    const masked = await store.get(state.key) === null && native.has(state.key);
    unavailable = false;
    const reconciled = await store.get(state.key) === null && !native.has(state.key) && !web.has(storageJournalKey(state.key));
    process.stdout.write(JSON.stringify({masked,reconciled}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000,
    env: { ...process.env, CIVIGO_FIXTURE_STORES: JSON.stringify({ native: [...f.native], web: [...f.web], key: tripKey }) } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { masked: true, reconciled: true });
});

test('una escritura nativa anterior no borra el tombstone posterior y dos instancias comparten el orden', async () => {
  const f = fixture(), gate = f.block('set:trip');
  const saving = f.storage.set('trip', 'A'); await gate.started;
  const other = new ResilientStorage(f.driver, () => f.journal);
  f.failures.set('remove:trip', 1);
  const removing = other.remove('trip'); gate.release();
  await saving; await removing;
  assert.equal(JSON.parse(f.web.get(storageJournalKey('trip'))!).operation, 'remove');
  assert.equal(await f.restart().get('trip'), null);
  assert.equal(f.native.has('trip'), false);
});

test('ABA conserva la última intención aun cuando coincide su valor y falla el último commit nativo', async () => {
  const f = fixture(), gate = f.block('set:trip');
  const a = f.storage.set('trip', 'A'); await gate.started;
  const remove = f.storage.remove('trip');
  const b = f.storage.set('trip', 'A');
  const last = f.web.get(storageJournalKey('trip'))!;
  f.failures.set('set:trip', 2); gate.release();
  await Promise.all([a, remove, b]);
  assert.equal(f.web.get(storageJournalKey('trip')), last);
  assert.equal(await f.restart().get('trip'), 'A');
  assert.equal(f.native.get('trip'), 'A');
  assert.equal(f.web.has(storageJournalKey('trip')), false);
});

test('quota en B no descarta su commit después de que A limpia el journal anterior', async () => {
  const f = fixture(), gate = f.block('set:key');
  const a = f.storage.set('key', 'A'); await gate.started;
  f.quota(true);
  const b = f.storage.set('key', 'B'); gate.release();
  await Promise.all([a, b]);
  assert.equal(f.native.get('key'), 'B');
  assert.equal(await f.storage.get('key'), 'B');
});

test('A → lectura → B con quota devuelve el último valor y no revive el anterior', async () => {
  const f = fixture(), gate = f.block('get:key');
  f.native.set('key', 'old');
  const read = f.storage.get('key'); await gate.started;
  const a = f.storage.set('key', 'A');
  const middle = f.storage.get('key');
  f.quota(true); const b = f.storage.set('key', 'B');
  gate.release(); await Promise.all([read, a, middle, b]);
  assert.equal(f.native.get('key'), 'B');
  assert.equal(await f.restart().get('key'), 'B');
});

test('una lectura adelantada que reconcilia B impide que A antiguo vuelva a sobrescribirlo', async () => {
  const f = fixture();
  f.native.set('key', 'old');
  // The read is queued first, but synchronous write-ahead intents arrive before
  // its microtask starts. It must commit B; A must never replay afterwards.
  const read = f.storage.get('key');
  f.quota(true); const a = f.storage.set('key', 'A');
  f.quota(false); const b = f.storage.set('key', 'B');
  assert.equal(await read, 'B'); await Promise.all([a, b]);
  assert.equal(f.native.get('key'), 'B');
  assert.equal(f.applied.includes('A'), false);
});

test('si journal y nativo fallan la escritura o eliminación rechazan sin falso éxito', async () => {
  const f = fixture(); f.quota(true);
  f.failures.set('set:key', 1);
  await assert.rejects(f.storage.set('key', 'new'), /guardar/);
  f.native.set('key', 'old'); f.failures.set('remove:key', 1);
  await assert.rejects(f.storage.remove('key'), /guardar/);
  assert.equal(f.native.get('key'), 'old');
  assert.equal(f.web.size, 0);
});

test('quota sólo en journal permite set/remove nativos sanos y la cola se recupera tras rechazo', async () => {
  const f = fixture(); f.quota(true); f.failures.set('set:key', 1);
  await assert.rejects(f.storage.set('key', 'failed'));
  await f.storage.set('key', 'ok'); assert.equal(await f.storage.get('key'), 'ok');
  await f.storage.remove('key'); assert.equal(await f.storage.get('key'), null);
});

test('journal ilegible falla cerrado incluso con Preferences sano y vuelve a funcionar al recuperarse', async () => {
  const f = fixture(); f.native.set('key', 'old'); f.inaccessible(true);
  await assert.rejects(f.storage.get('key'), /SecurityError/);
  await assert.rejects(f.storage.set('key', 'new'), /SecurityError/);
  await assert.rejects(f.storage.remove('key'), /SecurityError/);
  assert.equal(f.native.get('key'), 'old');
  f.inaccessible(false); assert.equal(await f.storage.get('key'), 'old');
});

test('journal corrupto no se interpreta como ausencia de logout', async () => {
  const f = fixture(); f.web.set(storageJournalKey('civigo:logout-pending'), '{corrupt');
  const boundary = new SessionRevocation(f.storage, async () => {}, () => true);
  await assert.rejects(boundary.hasPending(), /recuperar/);
  await assert.rejects(boundary.authenticate(async () => assert.fail('No debe autenticar')));
});

test('un fallo nativo de lectura sin fallback confirmado rechaza, no devuelve falso null', async () => {
  const f = fixture(); f.failures.set('get:key', 1);
  await assert.rejects(f.storage.get('key'), /leer/);
});

test('una lectura nativa sana limpia legacy y su error de limpieza nunca devuelve el valor obsoleto', async () => {
  const f = fixture(); f.web.set('trip', 'obsolete'); f.failCleanup(true);
  await assert.rejects(f.storage.get('trip'), /cleanup/);
  f.failCleanup(false); assert.equal(await f.storage.get('trip'), null);
  assert.equal(f.web.has('trip'), false);
  f.web.set('trip', 'obsolete'); await f.storage.set('trip', 'new');
  assert.equal(f.web.has('trip'), false);
  f.web.set('trip', 'obsolete'); await f.storage.remove('trip');
  assert.equal(f.web.has('trip'), false); assert.equal(f.native.has('trip'), false);
});

test('legacy logout true se conserva aunque un get nativo sano no tenga la bandera', async () => {
  const f = fixture(); f.web.set('civigo:logout-pending', 'true');
  const boundary = new SessionRevocation(f.storage, async () => {}, () => true);
  assert.equal(await boundary.hasPending(), true);
  assert.equal(f.native.get('civigo:logout-pending'), 'true');
  assert.equal(f.web.has('civigo:logout-pending'), false);
  await boundary.flush();
  assert.equal(await boundary.hasPending(), false);
});

test('legacy disponible durante fallo nativo migra a journal durable y después retira la clave alternativa', async () => {
  const f = fixture(); f.web.set('key', 'legacy'); f.failures.set('get:key', 1);
  assert.equal(await f.storage.get('key'), 'legacy');
  assert.equal(f.web.has(storageJournalKey('key')), true);
  assert.equal(await f.restart().get('key'), 'legacy');
  assert.equal(f.native.get('key'), 'legacy');
  assert.equal(f.web.has('key'), false); assert.equal(f.web.has(storageJournalKey('key')), false);
});
