import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {recentNearbyIncidents, RECENT_INCIDENT_RADIUS_METERS, RECENT_INCIDENT_LIMIT} = loadTs('lib/recent-incidents.ts');
const {filterIncidentsByType} = loadTs('lib/incident-filters.ts');
const origin = {latitud: -14.0678, longitud: -75.7286};
const north = meters => ({...origin, latitud: origin.latitud + meters / 6371000 * 180 / Math.PI});
const incident = (id, values = {}) => ({id, tipo: 'robo', tipoSlug: 'robo', estado: 'ACTIVO', nivelRiesgo: 3, totalReportes: 1, publicado: true, ...origin, fechaCreacion: '2026-10-01T00:00:00Z', ...values});

test('nearby recent reports are latest ten by publication, independently of incident event date', () => {
    const reports = Array.from({length: 14}, (_, index) => incident(index + 1, {fechaPublicacion: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`, fechaEvento: '2020-01-01T00:00:00Z'}));
    reports.push(incident(100, {fechaPublicacion: '2026-09-01T00:00:00Z', fechaEvento: '2026-10-30T00:00:00Z'}));
    const before = reports.map(report => report.id);
    assert.equal(RECENT_INCIDENT_RADIUS_METERS, 1000);
    assert.equal(RECENT_INCIDENT_LIMIT, 10);
    assert.deepEqual(recentNearbyIncidents(reports, origin).map(report => report.id), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    assert.deepEqual(reports.map(report => report.id), before);
});

test('GPS radius is inclusive at one km and excludes distant, unpublished or invalid coordinates', () => {
    const reports = [incident(1, north(0)), incident(2, north(999.9)), incident(3, north(1000.1)), incident(4, {latitud: NaN}), incident(5, {longitud: 181}), incident(6, {publicado: false})];
    assert.deepEqual(recentNearbyIncidents(reports, origin).map(report => report.id), [2, 1]);
    assert.equal(recentNearbyIncidents([incident(7, north(1000))], origin).length, 1);
});

test('no GPS or invalid GPS never substitutes a map center or returns unrestricted reports', () => {
    const reports = [incident(1)];
    for (const point of [null, undefined, {latitud: NaN, longitud: -75}, {latitud: 100, longitud: -75}]) assert.deepEqual(recentNearbyIncidents(reports, point), []);
});

test('legacy creation dates are fallback dates and timestamp ties use newest id first', () => {
    const reports = [incident(1), incident(2, {fechaPublicacion: 'invalid', fechaCreacion: '2026-10-02T00:00:00Z'}), incident(3, {fechaCreacion: undefined, creadoEn: '2026-10-03T00:00:00Z'}), incident(4, {fechaCreacion: undefined, fecha: '2026-10-03T00:00:00Z'}), incident(5, {fechaCreacion: undefined, fechaEvento: '2026-10-30T00:00:00Z'})];
    assert.deepEqual(recentNearbyIncidents(reports, origin).map(report => report.id), [4, 3, 2, 1, 5]);
});

test('type filtering occurs before taking latest ten so other categories do not consume its places', () => {
    const reports = Array.from({length: 20}, (_, index) => incident(index + 1, {tipo: index % 2 ? 'inundacion' : 'robo', tipoSlug: index % 2 ? 'inundacion' : 'robo', fechaPublicacion: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`}));
    assert.deepEqual(recentNearbyIncidents(filterIncidentsByType(reports, 'robo'), origin).map(report => report.id), [19, 17, 15, 13, 11, 9, 7, 5, 3, 1]);
});
