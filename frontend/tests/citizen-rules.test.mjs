import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { citizenRules, groupingExplanation, confirmationExplanation } = loadTs('lib/citizen-rules.ts');

test('las reglas ciudadanas muestran los parámetros vigentes y no los números iniciales', () => {
  const rules = citizenRules({ agrupacionMetros: 100, agrupacionHoras: 1, confirmacionMetros: 20, confirmaciones: 5 });
  assert.equal(rules.confirmaciones, 5);
  assert.match(groupingExplanation(rules), /100 metros, dentro de 1 hora,/);
  assert.match(confirmationExplanation(rules), /20 metros o menos/);
  assert.doesNotMatch(confirmationExplanation(rules), /50 metros/);
  assert.match(groupingExplanation(citizenRules({ agrupacionHoras: 4 })), /4 horas/);
});

test('catálogos antiguos conservan valores válidos y los errores no inventan una distancia exacta', () => {
  const defaults = citizenRules({});
  assert.deepEqual(defaults, { agrupacionMetros: 50, agrupacionHoras: 3, confirmacionMetros: 50, confirmaciones: 3 });
  for (const value of [null, '20', 0, NaN, Infinity, -10, 300, 1.5])
    assert.equal(citizenRules({ confirmacionMetros: value }).confirmacionMetros, 50);
  assert.doesNotMatch(confirmationExplanation(null), /\d+ metros/);
});
