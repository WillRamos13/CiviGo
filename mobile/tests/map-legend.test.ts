import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RiskLegend, TrafficLegend } from '../src/components/map/RiskLegend';

test('fixed legends contain only the label and colors; availability details stay in the layer panel', () => {
  const status = 'Actualización pendiente de una conexión válida';
  const risk = renderToStaticMarkup(React.createElement(RiskLegend, { compact: true, status }));
  assert.equal((risk.match(/background-color:/g) ?? []).length, 6);
  assert.ok(risk.includes('Riesgo por zona'));
  assert.ok(!risk.includes(status));
  assert.ok(!risk.includes('map-legend-levels'));
  assert.ok(!risk.includes('map-legend-ends'));
  assert.ok(!risk.includes('<small'));
  const traffic = renderToStaticMarkup(React.createElement(TrafficLegend, { compact: true, status, available: false }));
  assert.equal((traffic.match(/background-color:/g) ?? []).length, 3);
  assert.ok(traffic.includes('map-legend-unavailable'));
  assert.ok(!traffic.includes(status));
  assert.ok(!traffic.includes('map-traffic-labels'));
  assert.ok(!traffic.includes('<small'));
  const detailed = renderToStaticMarkup(React.createElement(RiskLegend, { status }));
  assert.ok(detailed.includes(status));
  assert.ok(detailed.includes('map-legend-levels'));
  assert.ok(detailed.includes('Seguro') && detailed.includes('Crítico'));
});
