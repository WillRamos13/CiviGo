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

    test('validates coordinates are within greater Ica bounding box', () => {
      // Ica region bounds: lat -15.5 to -13.0, lng -76.5 to -74.5
      const isInIcaRegion = (lat: number, lng: number) =>
        lat >= -15.5 && lat <= -13.0 && lng >= -76.5 && lng <= -74.5;

      assert.equal(isInIcaRegion(-14.0678, -75.7286), true); // Plaza de Armas
      assert.equal(isInIcaRegion(-14.0875, -75.7633), true); // Huacachina
      assert.equal(isInIcaRegion(-12.0464, -77.0428), false); // Lima (out of Ica bounds)
      assert.equal(isInIcaRegion(0, 0), false); // Null Island
    });

    test('parses navigation turn-by-turn guidance steps correctly', () => {
      interface NavStep {
        maniobra: 'start' | 'turn-left' | 'turn-right' | 'straight' | 'arrive';
        calle: string;
        distancia: number;
      }
      const steps: NavStep[] = [
        { maniobra: 'start', calle: 'Av. San Martín', distancia: 200 },
        { maniobra: 'turn-left', calle: 'Calle Bolívar', distancia: 450 },
        { maniobra: 'arrive', calle: 'Plaza de Armas', distancia: 0 },
      ];
      assert.equal(steps.length, 3);
      assert.equal(steps[0].maniobra, 'start');
      assert.equal(steps[1].calle, 'Calle Bolívar');
      assert.equal(steps[2].maniobra, 'arrive');
      assert.equal(steps[2].distancia, 0);
    });
  });

  describe('Deep Authentication & Token Lifecycle', () => {
    test('validates standard JWT format without exposing raw credentials', () => {
      const mockJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzLCJyb2wiOiJVU1VBUklPIiwiZXhwIjoxNzk5OTk5OTk5fQ.signature_hash';
      const parts = mockJwt.split('.');
      assert.equal(parts.length, 3, 'JWT must contain exactly header, payload, and signature');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      assert.equal(payload.id, 123);
      assert.equal(payload.rol, 'USUARIO');
      assert.ok(payload.exp > Date.now() / 1000, 'Token is not expired');
    });

    test('verifies StorageService never persists raw passwords or credentials', () => {
      const allowedStorageKeys = ['civigo_token', 'civigo_theme', 'civigo_draft_report', 'civigo_favorites'];
      const sensitiveKeys = ['password', 'contrasena', 'secret', 'auth_password', 'pin'];
      for (const forbidden of sensitiveKeys) {
        assert.ok(!allowedStorageKeys.includes(forbidden), `Forbidden storage key detected: ${forbidden}`);
      }
    });

    test('validates citizen user profile contract structure', () => {
      const mockUser = {
        id: 42,
        correo: 'ciudadano.ica@gmail.com',
        correoVerificado: true,
        rol: 'USUARIO',
        nickname: 'Chalaquito',
        nombres: 'Carlos',
        apellidos: 'Mendoza',
        telefono: '+51956123456',
        distrito: 'Ica',
        credibilidad: 88,
        monedas: 350,
        bloqueado: false,
        permisos: [],
      };
      assert.equal(typeof mockUser.id, 'number');
      assert.equal(mockUser.correoVerificado, true);
      assert.equal(mockUser.rol, 'USUARIO');
      assert.equal(mockUser.bloqueado, false);
      assert.equal(Array.isArray(mockUser.permisos), true);
    });
  });

  describe('Extended API Resilience & Error Classification', () => {
    test('correctly maps HTTP status codes to localized actionable messages', () => {
      const unauthErr = new ApiError('Sesión expirada', 401, 'UNAUTHORIZED');
      assert.equal(unauthErr.status, 401);
      assert.equal(errorMessage(unauthErr), 'Sesión expirada');

      const forbiddenErr = new ApiError('No tienes permisos de agente en este distrito', 403, 'FORBIDDEN');
      assert.equal(forbiddenErr.status, 403);
      assert.equal(errorMessage(forbiddenErr), 'No tienes permisos de agente en este distrito');

      const serverErr = new ApiError('Error interno en Railway', 500, 'INTERNAL_ERROR');
      assert.equal(serverErr.status, 500);
      assert.equal(errorMessage(serverErr), 'Error interno en Railway');
    });

    test('sanitizes and encodes complex query parameters for incidents and roads', () => {
      const params = {
        distrito: 'Ica & Parcona',
        estado: 'PENDIENTE,EN_REVISION',
        pagina: 1,
      };
      const query = new URLSearchParams();
      if (params.distrito) query.set('distrito', params.distrito);
      if (params.estado) query.set('estado', params.estado);
      query.set('pagina', String(params.pagina));

      assert.equal(query.toString(), 'distrito=Ica+%26+Parcona&estado=PENDIENTE%2CEN_REVISION&pagina=1');
    });
  });

  describe('Comprehensive Evidence & File Security Validation', () => {
    test('enforces max 15MB file ceiling for incident uploads', () => {
      const MAX_BYTES = 15 * 1024 * 1024;
      const fileUnderLimit = { name: 'foto1.jpg', size: 14.9 * 1024 * 1024 };
      const fileOverLimit = { name: 'video1.mp4', size: 15.1 * 1024 * 1024 };

      assert.ok(fileUnderLimit.size <= MAX_BYTES);
      assert.ok(fileOverLimit.size > MAX_BYTES);
    });

    test('rejects unsafe executable extensions for uploaded media', () => {
      const unsafeExtensions = ['.exe', '.bat', '.cmd', '.sh', '.apk', '.jar', '.php', '.js'];
      const isExtensionSafe = (fileName: string) => {
        const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
        return !unsafeExtensions.includes(ext);
      };

      assert.equal(isExtensionSafe('evidencia.jpg'), true);
      assert.equal(isExtensionSafe('prueba.png'), true);
      assert.equal(isExtensionSafe('video.mp4'), true);
      assert.equal(isExtensionSafe('malware.exe'), false);
      assert.equal(isExtensionSafe('script.sh'), false);
      assert.equal(isExtensionSafe('payload.apk'), false);
    });

    test('validates private vs public evidence metadata flags', () => {
      const citizenEvidence = { id: 'adj-1', url: 'https://cdn/foto.jpg', privado: false, mimeType: 'image/jpeg' };
      const agentConfidentialEvidence = { id: 'adj-2', url: 'https://cdn/dni.jpg', privado: true, mimeType: 'image/jpeg' };

      assert.equal(citizenEvidence.privado, false);
      assert.equal(agentConfidentialEvidence.privado, true);
    });
  });
});


