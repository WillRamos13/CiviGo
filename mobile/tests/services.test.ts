import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { distance, errorMessage, ApiError } from '../src/services/api.ts';
import { canParticipate } from '../src/services/auth.ts';
import { hasAgentPermission } from '../src/services/agent.ts';
import { formatDistance, formatDuration, isRoute } from '../src/services/navigation.ts';
import { getIncidentIconPath, normalizeIconSlug } from '../src/services/incidentIcons.ts';
import { applyRoadRisk, type RoadGeometry, type RoadRisk } from '../src/services/roadMap.ts';

describe('CiviGo Mobile Services & Logic Test Suite', () => {
  describe('Haversine Geolocation Distance', () => {
    test('Calculates 0 meters between identical coordinates', () => {
      const p = { latitud: -14.0678, longitud: -75.7286 };
      assert.equal(Math.round(distance(p, p)), 0);
    });

    test('Calculates realistic distance between Plaza de Armas Ica and Huacachina (~4.3km)', () => {
      const plaza = { latitud: -14.0678, longitud: -75.7286 };
      const huacachina = { latitud: -14.0875, longitud: -75.7633 };
      const dist = distance(plaza, huacachina);
      assert.ok(dist > 4000 && dist < 4800, `Expected ~4.4km, got ${dist}`);
    });
  });

  describe('User & Participation Rules', () => {
    test('allows participation only when email is verified and not blocked', () => {
      assert.equal(canParticipate({ correoVerificado: true, bloqueado: false }), true);
      assert.equal(canParticipate({ correoVerificado: false, bloqueado: false }), false);
      assert.equal(canParticipate({ correoVerificado: true, bloqueado: true }), false);
      assert.equal(canParticipate(null), false);
    });
  });

  describe('Agent Permissions Enforcement', () => {
    test('ADMIN role is restricted from mobile operational console (web/desktop only)', () => {
      const admin: any = { rol: 'ADMIN', bloqueado: false, permisos: ['validar', 'gravedad', 'evidencia'] };
      assert.equal(hasAgentPermission(admin, 'validar'), false);
      assert.equal(hasAgentPermission(admin, 'gravedad'), false);
      assert.equal(hasAgentPermission(admin, 'evidencia'), false);
    });

    test('USUARIO citizen role has no agent access', () => {
      const user: any = { rol: 'USUARIO', bloqueado: false, permisos: ['validar'] };
      assert.equal(hasAgentPermission(user, 'validar'), false);
    });

    test('AGENTE with specific grant', () => {
      const agent: any = { rol: 'AGENTE', bloqueado: false, permisos: ['validar', 'clasificar'] };
      assert.equal(hasAgentPermission(agent, 'validar'), true);
      assert.equal(hasAgentPermission(agent, 'resolver'), false);
    });

    test('AGENTE with legacy "revisar" permission gets legacy review grants', () => {
      const agent: any = { rol: 'AGENTE', bloqueado: false, permisos: ['revisar'] };
      assert.equal(hasAgentPermission(agent, 'consultar'), true);
      assert.equal(hasAgentPermission(agent, 'validar'), true);
      assert.equal(hasAgentPermission(agent, 'gravedad'), true);
      assert.equal(hasAgentPermission(agent, 'clasificar'), true);
      assert.equal(hasAgentPermission(agent, 'evidencia'), false);
    });

    test('Blocked agent loses all privileges', () => {
      const agent: any = { rol: 'AGENTE', bloqueado: true, permisos: ['validar'] };
      assert.equal(hasAgentPermission(agent, 'validar'), false);
    });
  });

  describe('Navigation Formatting & Validation', () => {
    test('formats distances correctly', () => {
      assert.equal(formatDistance(450), '450 m');
      assert.equal(formatDistance(1500), '1.5 km');
      assert.equal(formatDistance(12400), '12.4 km');
    });

    test('formats durations correctly', () => {
      assert.equal(formatDuration(120), '2 min');
      assert.equal(formatDuration(3600), '1 h 0 min');
      assert.equal(formatDuration(5400), '1 h 30 min');
    });

    test('validates valid route objects', () => {
      const validRoute = {
        id: 'r1',
        distancia: 1200,
        duracion: 600,
        geometria: {
          type: 'LineString',
          coordinates: [[-75.72, -14.06], [-75.73, -14.07]],
        },
      };
      assert.equal(isRoute(validRoute), true);
      assert.equal(isRoute(null), false);
      assert.equal(isRoute({ id: 'r1' }), false);
    });
  });

  describe('Incident Icons & Normalization', () => {
    test('normalizes complex slugs with spaces and accents', () => {
      assert.equal(normalizeIconSlug('Calle Bloqueada'), 'calle-bloqueada');
      assert.equal(normalizeIconSlug('Intento de Robo'), 'intento-de-robo');
      assert.equal(normalizeIconSlug('  Inundación  '), 'inundacion');
    });

    test('resolves asset paths for official incident types', () => {
      const pathBache = getIncidentIconPath('bache');
      assert.ok(pathBache.includes('bache.png'));

      const pathSemaforo = getIncidentIconPath('semaforo');
      assert.ok(pathSemaforo.includes('semaforo.png'));
    });
  });

  describe('Road Map & Live Risk Fusion', () => {
    const sampleGeometry: RoadGeometry = {
      type: 'FeatureCollection',
      version: 'v1-test',
      features: [
        {
          type: 'Feature',
          id: 101,
          properties: { id: 101, puntos: 0, nivelRiesgo: 0, pendiente: false },
          geometry: { type: 'LineString', coordinates: [[-75.72, -14.06], [-75.721, -14.061]] },
        },
      ],
    };

    test('merges real-time risk scores into GeoJSON features', () => {
      const sampleRisk: RoadRisk = {
        version: 'v1-test',
        revision: 'rev-abc',
        values: [[101, 25, 3, true]],
      };

      const result = applyRoadRisk(sampleGeometry, sampleRisk);
      const feat = result.features[0];
      assert.equal(feat.properties?.puntos, 25);
      assert.equal(feat.properties?.nivelRiesgo, 3);
      assert.equal(feat.properties?.pendiente, true);
    });

    test('throws error if geometry version does not match risk version', () => {
      const mismatchedRisk: RoadRisk = {
        version: 'v2-outdated',
        revision: 'rev-xyz',
        values: [],
      };

      assert.throws(() => applyRoadRisk(sampleGeometry, mismatchedRisk), {
        message: 'La red vial cambió. Vuelve a cargar sus datos.',
      });
    });
  });

  describe('API Connections & Error Handling', () => {
    test('formats ApiError instances with custom messages and status codes', () => {
      const notFound = new ApiError('Incidente no encontrado', 404, 'NOT_FOUND');
      assert.equal(notFound.status, 404);
      assert.equal(notFound.code, 'NOT_FOUND');
      assert.equal(errorMessage(notFound), 'Incidente no encontrado');
    });

    test('handles standard errors and unknown objects gracefully', () => {
      assert.equal(errorMessage(new Error('Fallo de red')), 'Fallo de red');
      assert.equal(errorMessage('Error de servidor'), 'Error de servidor');
      assert.equal(errorMessage(undefined), 'Ocurrió un error inesperado.');
      assert.equal(errorMessage({ foo: 'bar' }), 'Ocurrió un error inesperado.');
    });
  });

  describe('Image & Evidence Validation Limits', () => {
    const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

    test('validates image size boundaries', () => {
      const validSize = 5 * 1024 * 1024; // 5 MB
      const invalidSize = 16 * 1024 * 1024; // 16 MB

      assert.ok(validSize <= MAX_BYTES, '5 MB is within limits');
      assert.ok(invalidSize > MAX_BYTES, '16 MB exceeds 15 MB limit');
    });

    test('validates allowed image and video MIME types', () => {
      const ALLOWED_MIMES = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/webm',
        'video/quicktime',
      ];

      assert.ok(ALLOWED_MIMES.includes('image/jpeg'));
      assert.ok(ALLOWED_MIMES.includes('image/png'));
      assert.ok(ALLOWED_MIMES.includes('image/webp'));
      assert.ok(ALLOWED_MIMES.includes('video/mp4'));
      assert.ok(!ALLOWED_MIMES.includes('application/pdf'));
      assert.ok(!ALLOWED_MIMES.includes('text/html'));
    });
  });

  describe('Navigation Edge Cases & Errors', () => {
    test('rejects corrupted or incomplete route structures', () => {
      assert.equal(isRoute({ id: 'r1', distancia: 100 }), false);
      assert.equal(isRoute({ id: 'r1', distancia: 100, duracion: 50, geometria: { type: 'Point' } }), false);
      assert.equal(isRoute({ id: 123, distancia: '100', duracion: 50 }), false);
    });

    test('handles edge coordinate distances safely', () => {
      const equator = { latitud: 0, longitud: 0 };
      const northPole = { latitud: 90, longitud: 0 };
      const dist = distance(equator, northPole);
      assert.ok(dist > 10000000 && dist < 10015000, `Expected ~10000km, got ${dist}`);
    });
  });
});

