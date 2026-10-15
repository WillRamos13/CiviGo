import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, errorMessage, ApiError, formatDate } from '../src/services/api';
import { canParticipate } from '../src/services/auth';
import { hasAgentPermission } from '../src/services/agent';
import { formatDistance, formatDuration, isRoute } from '../src/services/navigation';
import { getIncidentIconPath, normalizeIconSlug } from '../src/services/incidentIcons';
import { applyRoadRisk, type RoadGeometry } from '../src/services/roadMap';

test('distancia geográfica usa coordenadas reales y límites esféricos', () => {
  const plaza = { latitud: -14.0678, longitud: -75.7286 };
  assert.equal(distance(plaza, plaza), 0);
  const km = distance(plaza, { latitud: -14.0875, longitud: -75.7633 });
  assert.ok(km > 4000 && km < 4800);
  const quarter = distance({ latitud: 0, longitud: 0 }, { latitud: 90, longitud: 0 });
  assert.ok(quarter > 10000000 && quarter < 10015000);
});

test('participación requiere correo verificado y cuenta habilitada', () => {
  assert.equal(canParticipate(null), false);
  assert.equal(canParticipate({ correoVerificado: true, bloqueado: false }), true);
  assert.equal(canParticipate({ correoVerificado: false, bloqueado: false }), false);
  assert.equal(canParticipate({ correoVerificado: true, bloqueado: true }), false);
});

test('permisos de agentes no confían en permisos arbitrarios de ciudadanos o bloqueados', () => {
  assert.equal(hasAgentPermission({ rol: 'USUARIO', permisos: ['validar'] } as any, 'validar'), false);
  assert.equal(hasAgentPermission({ rol: 'AGENTE', bloqueado: true, permisos: ['validar'] } as any, 'validar'), false);
  assert.equal(hasAgentPermission({ rol: 'AGENTE', bloqueado: false, permisos: ['validar'] } as any, 'validar'), true);
  assert.equal(hasAgentPermission({ rol: 'AGENTE', bloqueado: false, permisos: ['validar'] } as any, 'resolver'), false);
  const legacy = { rol: 'AGENTE', bloqueado: false, permisos: ['revisar'] } as any;
  assert.equal(hasAgentPermission(legacy, 'consultar'), true);
  assert.equal(hasAgentPermission(legacy, 'validar'), true);
  assert.equal(hasAgentPermission(legacy, 'evidencia'), false);
});

test('formatos de ruta y validación rechazan estructuras incompletas', () => {
  assert.equal(formatDistance(450), '450 m');
  assert.equal(formatDistance(1500), '1.5 km');
  assert.equal(formatDuration(120), '2 min');
  assert.equal(formatDuration(5400), '1 h 30 min');
  assert.equal(isRoute({ id: 'r1', distancia: 1200, duracion: 600, geometria: {
    type: 'LineString', coordinates: [[-75.72, -14.06], [-75.73, -14.07]],
  } }), true);
  for (const invalid of [null, {}, { id: 'r1' }, { id: 'r1', distancia: 1, duracion: 1, geometria: { type: 'Point' } }]) {
    assert.equal(isRoute(invalid), false);
  }
});

test('iconos normalizan acentos y resuelven recursos existentes', () => {
  assert.equal(normalizeIconSlug('  Inundación  '), 'inundacion');
  assert.equal(normalizeIconSlug('Calle Bloqueada'), 'calle-bloqueada');
  assert.ok(getIncidentIconPath('bache').includes('bache.png'));
  assert.ok(getIncidentIconPath('semaforo').includes('semaforo.png'));
});

test('riesgo se combina con geometría sin perder versión y rechaza versión discordante', () => {
  const geometry: RoadGeometry = { type: 'FeatureCollection', version: 'v1', features: [{
    type: 'Feature', id: 101,
    properties: { id: 101, puntos: 0, nivelRiesgo: 0, pendiente: false },
    geometry: { type: 'LineString', coordinates: [[-75.72, -14.06], [-75.721, -14.061]] },
  }] };
  const result = applyRoadRisk(geometry, { version: 'v1', revision: 'r1', values: [[101, 12, 3, true]] });
  assert.equal(result.features[0].properties?.puntos, 12);
  assert.equal(result.features[0].properties?.nivelRiesgo, 3);
  assert.equal(result.features[0].properties?.pendiente, true);
  assert.throws(() => applyRoadRisk(geometry, { version: 'v2', revision: 'r2', values: [] }), /red vial cambió/);
});

test('mensajes y fechas usan la implementación de CiviGo', () => {
  const error = new ApiError('Sesión expirada', 401, 'UNAUTHORIZED');
  assert.equal(errorMessage(error), 'Sesión expirada');
  assert.equal(error.status, 401);
  assert.equal(errorMessage(new Error('Fallo de red')), 'Fallo de red');
  assert.equal(errorMessage(undefined), 'Ocurrió un error inesperado.');
  assert.equal(formatDate('invalid'), 'Fecha no disponible');
  assert.match(formatDate('2026-10-15T02:00:00Z'), /14/);
});
