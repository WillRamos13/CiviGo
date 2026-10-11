const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStorage } = require('../src/lib/storage');

test('Temporary cleanup removes only old unreferenced plain UUID files from its own directory', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'civigo-temp-cleanup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const now = new Date();
  const old = new Date(+now - 2 * 86400000);
  const create = async (name = crypto.randomUUID(), time = old) => {
    const filename = path.join(directory, name);
    await fs.writeFile(filename, 'fixture temporary data'); await fs.utimes(filename, time, time);
    return { name, filename };
  };
  const orphan = await create();
  const recent = await create(crypto.randomUUID(), new Date(+now - 3600000));
  const boundary = await create(crypto.randomUUID(), new Date(+now - 86400000));
  const byId = await create();
  const byPath = await create();
  const other = await create('photo-from-user.jpg');
  const uuidFolder = path.join(directory, crypto.randomUUID());
  await fs.mkdir(uuidFolder); await fs.writeFile(path.join(uuidFolder, crypto.randomUUID()), 'retained nested file');
  const rows = [{ id: byId.name, path: 'supabase://fixture/retained-by-id' }, { id: 'legacy-id', path: byPath.filename }];
  const db = { attachment: { findMany: async ({ where }) => rows.filter(row => where.OR[0].id.in.includes(row.id) || where.OR[1].path.in.includes(row.path)) } };
  const storage = createStorage({ directory, env: { STORAGE_PROVIDER: 'local' }, fetchImpl: () => assert.fail('No network during temporary cleanup') });
  assert.equal(await storage.cleanupTemporary(db, now), 1);
  await assert.rejects(fs.stat(orphan.filename), { code: 'ENOENT' });
  for (const file of [recent, boundary, byId, byPath, other]) assert.equal((await fs.stat(file.filename)).isFile(), true);
  assert.equal((await fs.stat(uuidFolder)).isDirectory(), true);

  const inaccessible = await create();
  const failingDb = { attachment: { findMany: async () => { throw new Error('Fixture database outage'); } } };
  assert.equal(await storage.cleanupTemporary(failingDb, now), 0);
  assert.equal((await fs.stat(inaccessible.filename)).isFile(), true);
  const changingDb = { attachment: { findMany: async query => {
    await fs.utimes(inaccessible.filename, now, now);
    return db.attachment.findMany(query);
  } } };
  assert.equal(await storage.cleanupTemporary(changingDb, now), 0);
  assert.equal((await fs.stat(inaccessible.filename)).isFile(), true);
});

test('Temporary cleanup never follows UUID directory junctions or a linked root', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'civigo-temp-links-'));
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'civigo-temp-target-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); await fs.rm(target, { recursive: true, force: true }); });
  const name = crypto.randomUUID();
  const file = path.join(target, name);
  const old = new Date(Date.now() - 2 * 86400000);
  await fs.writeFile(file, 'outside managed directory'); await fs.utimes(file, old, old);
  const link = path.join(directory, crypto.randomUUID());
  await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  const db = { attachment: { findMany: async () => assert.fail('Links cannot become deletion candidates') } };
  assert.equal(await createStorage({ directory }).cleanupTemporary(db), 0);
  assert.equal(await createStorage({ directory: link }).cleanupTemporary(db), 0);
  assert.equal(await fs.readFile(file, 'utf8'), 'outside managed directory');
});
