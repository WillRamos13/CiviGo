import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { AgentService, normalizeAgentIncidents } from '../src/services/agent';
import { CommunityService, normalizeRanking, normalizeRewards, canRedeemReward } from '../src/services/community';
import { resolveMediaUrl } from '../src/services/media';
import { getIncidentIconPath } from '../src/services/incidentIcons';

const entry = { position: 1, nickname: 'Vecina', puntos: 30, credibilidad: 0, monedasEstimadas: 90 };
const reward = { id: 42, nombre: 'Reconocimiento', descripcion: 'Premio demo', costoMonedas: 10, stock: 2, activo: true, demo: true };
const catalog = { monedas: 20, recompensas: [reward], canjes: [], demo: true };

test('agent consumes legacy arrays and the actual paginated items envelope without dropping private evidence', async (t) => {
  const incident = { id: 8, reportes: [{ id: 9, adjuntos: [{ id: 'private-file', privado: true, url: '/api/uploads/private-file' }] }] };
  const calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(new URL(url, 'https://offline.test'));
    return Response.json(calls.length === 1 ? [incident] : { items: [incident], total: 87, page: 2, pageSize: 50, pages: 2 });
  });
  assert.deepEqual(await AgentService.getIncidents(), { total: 1, items: [incident], page: 1, pageSize: 1, pages: 1 });
  assert.deepEqual(await AgentService.getIncidents({ pagina: 2, estado: 'REVISION' }), { total: 87, items: [incident], page: 2, pageSize: 50, pages: 2 });
  assert.equal(calls[0].searchParams.get('page'), '1');
  assert.equal(calls[0].searchParams.get('limit'), '50');
  assert.equal(calls[1].searchParams.get('page'), '2');
  assert.equal(calls[1].searchParams.has('pagina'), false);
  assert.equal(calls[1].pathname, '/api/admin/incidents');
  assert.deepEqual(normalizeAgentIncidents([]), { total: 0, items: [], page: 1, pageSize: 50, pages: 1 });
  assert.throws(() => normalizeAgentIncidents({ incidentes: [] }), /respuesta/);
});

test('agent pages and server search reach incidents beyond the old 250-item ceiling', async (t) => {
  const incidents = Array.from({ length: 251 }, (_, index) => ({ id: index + 1, tipo: 'Bache' }));
  const requests: URL[] = [];
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    const parsed = new URL(url, 'https://offline.test');
    requests.push(parsed);
    assert.equal(parsed.searchParams.get('estado'), 'ACTIVO');
    assert.ok(options.signal instanceof AbortSignal);
    const page = Number(parsed.searchParams.get('page'));
    const pageSize = Number(parsed.searchParams.get('limit'));
    assert.equal(pageSize, 50);
    const query = parsed.searchParams.get('q');
    const filtered = query ? incidents.filter((item) => String(item.id) === query) : incidents;
    return Response.json({ items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length, page, pageSize, pages: Math.max(1, Math.ceil(filtered.length / pageSize)) });
  });
  const first = await AgentService.getIncidents({ estado: 'ACTIVO' }, { signal: controller.signal });
  assert.equal(first.total, 251);
  assert.equal(first.pages, 6);
  assert.equal(first.items.length, 50);
  const last = await AgentService.getIncidents({ estado: 'ACTIVO', pagina: 6 });
  assert.deepEqual(last.items.map((item) => item.id), [251]);
  const found = await AgentService.getIncidents({ estado: 'ACTIVO', busqueda: ' 251 ' });
  assert.equal(found.total, 1);
  assert.equal(found.pages, 1);
  assert.equal(found.items[0].id, 251);
  assert.equal(requests[2].searchParams.get('q'), '251');
  assert.equal(requests[2].searchParams.get('page'), '1');
});

test('agent review uses the real review endpoint and forwards the required reason and gravity', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /\/admin\/incidents\/8\/review$/);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(String(options.body)), { accion: 'GRAVEDAD', motivo: 'Inspección en campo', nivelRiesgo: 4 });
    return Response.json({ id: 8 });
  });
  await AgentService.applyIncidentReview(8, { accion: 'GRAVEDAD', motivo: 'Inspección en campo', nivelRiesgo: 4 });
});

test('validation and gravity reviews require a backend-valid level from one to five before transport', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Unexpected request'); });
  await assert.rejects(AgentService.applyIncidentReview(8, { accion: 'VALIDAR', motivo: 'Inspección en campo' }), /entre 1 y 5/);
  await assert.rejects(AgentService.applyIncidentReview(8, { accion: 'GRAVEDAD', motivo: 'Inspección en campo', nivelRiesgo: 0 }), /entre 1 y 5/);
  await assert.rejects(AgentService.applyReportReview(9, { accion: 'VALIDAR', motivo: 'Inspección en campo', nivelRiesgo: 6 }), /entre 1 y 5/);
  assert.equal(requests, 0);
});

test('classification sends only the catalog type ID and required reason to the dedicated backend route', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /\/admin\/incidents\/8\/classify$/);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(String(options.body)), { tipoId: 14, motivo: 'Tipo confirmado en campo' });
    return Response.json({ id: 8 });
  });
  await AgentService.classifyIncident(8, { tipoId: 14, motivo: ' Tipo confirmado en campo ' });
});

test('agent report approval sends its own ID, gravity and reason without reviewing every grouped author', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /\/admin\/reports\/91\/review$/);
    assert.deepEqual(JSON.parse(String(options.body)), { accion: 'VALIDAR', motivo: 'Pruebas revisadas', nivelRiesgo: 2 });
    return Response.json({ id: 91, estado: 'VALIDADO' });
  });
  await AgentService.applyReportReview(91, { accion: 'VALIDAR', motivo: 'Pruebas revisadas', nivelRiesgo: 2 });
});

test('agent flag review and message moderation preserve backend endpoints and action names', async (t) => {
  const requests: { path: string; method: string | undefined; body?: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    const path = new URL(url, 'https://offline.test').pathname;
    requests.push({ path, method: options.method, ...(options.body ? { body: JSON.parse(String(options.body)) } : {}) });
    return Response.json(path.endsWith('/messages') ? [{ id: 66, mensaje: 'Aviso', retirado: false }] : { id: 66 });
  });
  await AgentService.reviewFlag(8, 51, 'Aviso atendido');
  const messages = await AgentService.getMessages(8);
  assert.equal(messages[0].id, 66);
  await AgentService.moderateMessage(8, 66, { accion: 'RETIRAR', motivo: 'Mensaje inapropiado' });
  await AgentService.moderateMessage(8, 66, { accion: 'RESTAURAR', motivo: 'Revisión posterior' });
  assert.deepEqual(requests, [
    { path: '/api/admin/incidents/8/flags/51/review', method: 'POST', body: { motivo: 'Aviso atendido' } },
    { path: '/api/admin/incidents/8/messages', method: undefined },
    { path: '/api/admin/incidents/8/messages/66/moderate', method: 'POST', body: { accion: 'RETIRAR', motivo: 'Mensaje inapropiado' } },
    { path: '/api/admin/incidents/8/messages/66/moderate', method: 'POST', body: { accion: 'RESTAURAR', motivo: 'Revisión posterior' } },
  ]);
});

test('agent classification, flags and moderation reject missing IDs or short reasons without requests', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Unexpected request'); });
  await assert.rejects(AgentService.classifyIncident(8, { tipoId: 0, motivo: 'Cambio justificado' }), /identificador/);
  await assert.rejects(AgentService.reviewFlag(8, 51, 'ok'), /motivo/);
  await assert.rejects(AgentService.moderateMessage(8, -1, { accion: 'RETIRAR', motivo: 'Contenido inapropiado' }), /identificador/);
  assert.equal(requests, 0);
});

test('public ranking preserves server ties, credibility zero, and no fabricated IDs or report counts', async (t) => {
  const response = { mes: '2026-10', finalized: false, demo: true, entries: [entry, { ...entry, nickname: 'Vecino' }, { ...entry, position: 3, nickname: 'Otra vecina' }] };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.match(url, /\/ranking$/);
    return Response.json(response);
  });
  const result = await CommunityService.getRanking();
  assert.deepEqual(result.entries.map((item) => item.position), [1, 1, 3]);
  assert.equal(result.entries[0].credibilidad, 0);
  assert.equal('id' in result.entries[0], false);
  assert.equal('reportesValidados' in result.entries[0], false);
  assert.throws(() => normalizeRanking({ ...response, entries: [{ nickname: 'Sin puesto' }] }), /ranking/);
  assert.throws(() => normalizeRanking({ ranking: [entry] }), /ranking/);
});

test('rewards use backend nombre, authoritative coins, stock and redemption history', async (t) => {
  const response = { ...catalog, canjes: [{ id: 10, recompensaId: 42, costoMonedas: 10, estado: 'SOLICITADO_DEMO', creadoEn: '2026-10-15T15:00:00Z' }] };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.match(url, /\/recompensas$/);
    return Response.json(response);
  });
  assert.deepEqual(await CommunityService.getRewards(), response);
  assert.equal(normalizeRewards(response).recompensas[0].nombre, 'Reconocimiento');
  assert.throws(() => normalizeRewards({ ...response, recompensas: [{ ...reward, id: undefined }] }), /recompensas/);
});

test('demo redemptions reject unavailable, unverified or non-demo requests before transport', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Unexpected request'); });
  for (const [item, data, verified] of [
    [{ ...reward, stock: 0 }, catalog, true],
    [{ ...reward, activo: false }, catalog, true],
    [{ ...reward, demo: false }, catalog, true],
    [reward, { ...catalog, demo: false }, true],
    [reward, { ...catalog, monedas: 0 }, true],
    [reward, catalog, false],
  ] as const) {
    assert.equal(canRedeemReward(item, data, verified), false);
    await assert.rejects(CommunityService.redeem(item, data, verified), /demostración/);
  }
  assert.equal(requests, 0);
});

test('a permitted demo redemption calls its actual ID endpoint and preserves the server status', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /\/recompensas\/42\/canjear$/);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    return Response.json({ id: 50, recompensaId: 42, costoMonedas: 10, estado: 'SOLICITADO_DEMO' });
  });
  assert.equal((await CommunityService.redeem(reward, catalog, true)).estado, 'SOLICITADO_DEMO');
});

test('community transport failures remain errors rather than appearing as an empty successful catalog', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Sesión vencida' }, { status: 401 }));
  await assert.rejects(CommunityService.getRewards(), /Sesión vencida/);
});

test('media resolves API attachments on Android and rejects external, data, credential and traversal URLs', () => {
  const base = 'https://api.example.test/api';
  assert.equal(resolveMediaUrl('/api/uploads/private-file', base), 'https://api.example.test/api/uploads/private-file');
  assert.equal(resolveMediaUrl('https://api.example.test/api/uploads/file_1', base), 'https://api.example.test/api/uploads/file_1');
  for (const url of ['https://evil.test/api/uploads/file', '//evil.test/api/uploads/file', 'data:image/png;base64,a', 'javascript:alert(1)', '/api/uploads/../auth/me', '/api/uploads/file?token=x', 'https://user:secret@api.example.test/api/uploads/file']) {
    assert.equal(resolveMediaUrl(url, base), null, url);
  }
  assert.equal(resolveMediaUrl('/api/uploads/file', 'ftp://api.example.test/api'), null);
});

test('the fallback incident icon is a bundled resource', () => {
  const fallback = getIncidentIconPath('unlisted-incident');
  assert.equal(fallback, '/iconos/alerta.svg');
  assert.ok(existsSync(`${process.cwd()}/public${fallback}`));
});
