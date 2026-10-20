import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTrafficStatus, getTrafficIncidents, readTrafficStatus, readTrafficResponse,
  trafficAvailable, trafficFlowMessage, trafficTileUrl } from '../src/services/traffic';

const status = { configurado: true, habilitado: true, controlCuotaDisponible: true,
  cuotas: { tiles: { restantes: 100 } }, cobertura: [-76.3, -15, -75.1, -13.3] };
const incident = { id: 'tomtom:1', externoId: '1', fuente: 'TOMTOM', tipo: 'calle-bloqueada',
  titulo: 'Vía cerrada', descripcion: 'Obras viales', latitud: -14, longitud: -75,
  geometria: { type: 'Point', coordinates: [-75, -14] }, inicio: null, fin: null,
  actualizadoEn: '2026-10-18T12:00:00.000Z', sentido: null, demoraSegundos: 30, temporal: true, afectaRiesgo: false };
const response = { incidentes: [incident], trafico: { disponible: true, fuente: 'TOMTOM', actualizadoEn: incident.actualizadoEn, motivo: '' } };

test('traffic availability separates configuration, quota, provider failure and recovery', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  const valid = readTrafficStatus(status);
  assert.equal(trafficAvailable(valid), true);
  assert.match(trafficFlowMessage(null), /comprobar/);
  assert.match(trafficFlowMessage({ ...valid, habilitado: false }), /administración/);
  assert.match(trafficFlowMessage({ ...valid, controlCuotaDisponible: false }), /cuota/);
  assert.match(trafficFlowMessage({ ...valid, cuotas: { tiles: { restantes: 0 } } }), /agotada/);
  const failed = { ...valid, fallos: { tiles: { codigo: 'UNAUTHORIZED', motivo: 'El proveedor no autorizó la capa.', reintentarEn: '2026-10-18T12:01:00Z' } } };
  assert.equal(trafficFlowMessage(failed, now), failed.fallos.tiles.motivo);
  assert.equal(trafficFlowMessage(failed, now + 120000), '', 'a completed provider backoff does not permanently disable retry');
  for (const bad of [null, {}, { ...status, configurado: 'true' }, { ...status, cobertura: [10, 0, -10, 1] },
    { ...status, cuotas: null }, { ...status, cuotas: { tiles: { restantes: -1 } } }, { ...status, ultimaActualizacion: { tiles: 'invalid' } }]) {
    assert.throws(() => readTrafficStatus(bad), /disponibilidad/);
  }
});

test('external events remain separate and unavailable responses cannot present old events as current', () => {
  assert.equal(readTrafficResponse(response).incidentes.length, 1);
  assert.equal(readTrafficResponse({ ...response, trafico: { ...response.trafico, disponible: false } }).incidentes.length, 0);
  for (const override of [{ latitud: 91 }, { afectaRiesgo: true }, { fuente: 'CIUDADANO' }, { demoraSegundos: NaN },
    { geometria: { type: 'Point', coordinates: [NaN, -14] } }, { geometria: { type: 'LineString', coordinates: [[-75, -14], [181, -14]] } }]) {
    assert.throws(() => readTrafficResponse({ ...response, incidentes: [{ ...incident, ...override }] }), /válidos/);
  }
});

test('raster URL uses only the configured HTTPS API and contains no provider or session key', () => {
  let requested = '';
  const url = trafficTileUrl(200, path => { requested = path; return `https://civigo-production.up.railway.app/api${path}`; });
  assert.equal(requested, '/navigation/traffic/tiles/flow/0/0/0.png');
  assert.equal(url, 'https://civigo-production.up.railway.app/api/navigation/traffic/tiles/flow/{z}/{x}/{y}.png?v=200');
  assert.deepEqual([...new URL(url).searchParams.keys()], ['v']);
  for (const target of ['http://civigo.online/api/navigation/traffic/tiles/flow/0/0/0.png',
    'https://user:pass@civigo.online/api/navigation/traffic/tiles/flow/0/0/0.png',
    'https://civigo.online/api/navigation/traffic/tiles/flow/0/0/0.png?key=hidden',
    'https://civigo.online/other.png']) assert.throws(() => trafficTileUrl(1, () => target), /HTTPS/);
  assert.throws(() => trafficTileUrl(NaN), /válida/);
});

test('traffic JSON endpoints use the standard API transport and forward cancellation', async () => {
  const previous = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async input => {
      const url = String(input); calls.push(url);
      return new Response(JSON.stringify(url.endsWith('/status') ? status : response));
    };
    assert.equal((await getTrafficStatus()).configurado, true);
    assert.equal((await getTrafficIncidents()).incidentes[0].afectaRiesgo, false);
    assert.ok(calls[0].endsWith('/api/navigation/traffic/status'));
    assert.ok(calls[1].endsWith('/api/navigation/traffic/incidents'));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => getTrafficStatus(controller.signal), { name: 'AbortError' });
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = previous; }
});
