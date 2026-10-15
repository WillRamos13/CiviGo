import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearReportDraft, readReportDraft, reportDraftKey, saveReportDraft, type DraftStorage } from '../src/services/reportDraft';

function storage() {
  const values = new Map<string, string>();
  const reads: string[] = [];
  const store: DraftStorage = {
    get: async (key) => { reads.push(key); return values.get(key) ?? null; },
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
  return { store, values, reads };
}

const first = { slug: 'robo', description: 'Descripción privada del primer usuario', eventDate: '' };
const second = { slug: 'bache', description: 'Otro borrador', eventDate: '' };

test('report drafts are scoped to their actual account IDs and never read the old unowned global key', async () => {
  const { store, values, reads } = storage();
  values.set('civigo:report-draft', JSON.stringify({ ...first, description: 'Datos de un propietario desconocido' }));
  await saveReportDraft(101, first, store);
  await saveReportDraft(202, second, store);
  assert.deepEqual(await readReportDraft(101, store), first);
  assert.deepEqual(await readReportDraft(202, store), second);
  assert.equal(await readReportDraft(303, store), null);
  assert.deepEqual(reads, ['civigo:report-draft:101', 'civigo:report-draft:202', 'civigo:report-draft:303']);
  assert.equal(reportDraftKey(101), 'civigo:report-draft:101');
});

test('guest and invalid account IDs never read or persist draft data', async () => {
  const { store, values, reads } = storage();
  await saveReportDraft(undefined, first, store);
  await clearReportDraft(undefined, store);
  assert.equal(await readReportDraft(undefined, store), null);
  for (const id of [null, undefined, 0, -2, 1.5, NaN]) assert.equal(reportDraftKey(id), null);
  assert.equal(values.size, 0);
  assert.deepEqual(reads, []);
});

test('clearing one account preserves another account and removes only the known owned draft', async () => {
  const { store, values } = storage();
  await saveReportDraft(104, first, store);
  await saveReportDraft(205, second, store);
  await clearReportDraft(104, store);
  assert.equal(await readReportDraft(104, store), null);
  assert.deepEqual(await readReportDraft(205, store), second);
  assert.equal(values.size, 1);
});

test('corrupted drafts are ignored and stored extras such as coordinates are never restored', async () => {
  const { store, values } = storage();
  const key = reportDraftKey(106)!;
  for (const raw of ['broken json', 'null', '[]', JSON.stringify({ ...first, description: {} }), JSON.stringify({ ...first, slug: '../other' })]) {
    values.set(key, raw);
    assert.equal(await readReportDraft(106, store), null);
  }
  values.set(key, JSON.stringify({ ...first, latitud: -14.0678, longitud: -75.7286 }));
  assert.deepEqual(await readReportDraft(106, store), first);
});

test('logout removal is ordered after an in-flight save, preventing private draft resurrection', async () => {
  const values = new Map<string, string>();
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => { release = resolve; });
  const store: DraftStorage = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { await deferred; values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
  const saved = saveReportDraft(107, first, store);
  const cleared = clearReportDraft(107, store);
  release();
  await Promise.all([saved, cleared]);
  assert.equal(await readReportDraft(107, store), null);
  assert.equal(values.size, 0);
});
