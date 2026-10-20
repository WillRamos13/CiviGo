import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactNavigationStatus, headingLabel, maneuverDirection, routeCriterionLabel, routeRiskSummary, splitNavigationWarnings } from '../src/services/navigationPresentation';
import type { Ruta } from '../src/types';

const route = { nivelRiesgo: 2, puntosRiesgo: 7.4, riesgoConocido: true } as Ruta;

test('route risk presentation never invents a profile, known risk or an exposure number', () => {
  assert.deepEqual(routeRiskSummary(route), { known: true, level: 2, exposure: 7.4 });
  for (const riesgoConocido of [false, undefined]) assert.deepEqual(routeRiskSummary({ ...route, riesgoConocido }), { known: false, level: null, exposure: null });
  for (const nivelRiesgo of [NaN, Infinity, -1, 6, 1.4]) assert.deepEqual(routeRiskSummary({ ...route, nivelRiesgo }), { known: false, level: null, exposure: null });
  assert.equal(routeRiskSummary({ ...route, puntosRiesgo: NaN }).exposure, null);
  assert.equal(routeRiskSummary({ ...route, puntosRiesgo: -4 }).exposure, null);
});

test('emergencies remain outside collapsed route conditions without duplicate notices', () => {
  const { urgent, conditions } = splitNavigationWarnings([
    'Hay una emergencia en este recorrido.', '  HAY UNA EMERGENCIA EN ESTE RECORRIDO  ',
    'Sin tráfico en vivo.', 'Sin tráfico en vivo', 'Riesgo sin verificar.', '',
  ]);
  assert.deepEqual(urgent, ['Hay una emergencia en este recorrido.']);
  assert.deepEqual(conditions, ['Sin tráfico en vivo.', 'Riesgo sin verificar.']);
});

test('maneuver icons and compass use actual instructions or GPS values', () => {
  assert.equal(maneuverDirection({ maniobra: 'izquierda', tipo: '' }), 'left');
  assert.equal(maneuverDirection({ maniobra: '', tipo: 'derecha' }), 'right');
  assert.equal(maneuverDirection({ maniobra: 'retorno', tipo: '' }), 'uturn');
  assert.equal(maneuverDirection({ maniobra: 'rotonda', tipo: '' }), 'roundabout');
  assert.equal(maneuverDirection({ maniobra: 'llegada', tipo: '' }), 'arrival');
  assert.equal(maneuverDirection(undefined), 'straight');
  assert.equal(headingLabel(0), 'N'); assert.equal(headingLabel(270), 'O'); assert.equal(headingLabel(360), 'N');
  for (const value of [undefined, NaN, Infinity, -1, 361]) assert.equal(headingLabel(value), null);
  assert.equal(routeCriterionLabel('segura'), 'Más segura');
  assert.equal(routeCriterionLabel('rapida'), 'Más rápida');
  assert.equal(routeCriterionLabel('equilibrada'), 'Equilibrada');
});

test('closure routing methodology stays in details while actual closure alerts remain prominent', () => {
  const explanation = 'Se evitan los tramos con cierres temporales de TomTom que coinciden con la cartografía, en ambos sentidos. No modifican el riesgo CiviGo.';
  const alert = 'Hay cierres externos cuya ubicación no permite asociarlos a una calle. Comprueba los avisos del mapa y la señalización.';
  const result = splitNavigationWarnings([explanation, alert]);
  assert.deepEqual(result.conditions, [explanation]);
  assert.deepEqual(result.urgent, [alert]);
});

test('compact status reports GPS loss before rerouting and keeps hazards accessible', () => {
  const status = compactNavigationStatus({ hasFix: false, offRoute: true, busy: true,
    urgent: ['Emergencia en la vía.'], voiceError: 'La voz no está disponible.' });
  assert.equal(status?.text, 'GPS pendiente · Alerta en la ruta · Voz no disponible');
  assert.ok(status?.description.includes('sin señal reciente'));
  assert.ok(status?.description.includes('Emergencia en la vía.'));
  assert.equal(status?.alert, true);
  assert.ok(!status?.text.includes('Recalculando'));
  assert.equal(compactNavigationStatus({ hasFix: true, offRoute: false, busy: false, urgent: [] }), null);
});

test('compact status distinguishes an actual deviation, recalculation and a failed request', () => {
  assert.equal(compactNavigationStatus({ hasFix: true, offRoute: true, busy: false, urgent: [] })?.text, 'Fuera de ruta');
  assert.equal(compactNavigationStatus({ hasFix: true, offRoute: true, busy: true, urgent: [] })?.text, 'Recalculando');
  const failure = compactNavigationStatus({ hasFix: true, offRoute: false, busy: false, urgent: [], error: 'Sin conexión.' });
  assert.deepEqual(failure, { text: 'Revisa la ruta', description: 'Sin conexión.', alert: true });
});
