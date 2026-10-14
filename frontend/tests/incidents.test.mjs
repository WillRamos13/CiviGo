import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';

const { reportPublicationState, isHistoricalAntecedent } = loadTs('lib/incidents.ts');

test('una carga inicial activa no se confunde con antecedentes históricos importados', () => {
    assert.equal(isHistoricalAntecedent({ estado: 'VALIDADO', historico: true, fuente: 'CARGA_INICIAL' }), false);
    assert.equal(isHistoricalAntecedent({ estado: 'RESUELTO', historico: true, fuente: 'CARGA_INICIAL' }), true);
    assert.equal(isHistoricalAntecedent({ estado: 'VALIDADO', fuente: 'REGISTRO_HISTORICO' }), true);
});

test('un aporte en revisión no hereda la aprobación del incidente publicado', () => {
    assert.equal(reportPublicationState({ estado: 'EN_REVISION' }, { publicado: true, evaluacion: 'AGENTE', porEvaluar: false }), 'review');
    assert.equal(reportPublicationState({ estado: 'EN_REVISION' }, { publicado: true, evaluacion: 'PENDIENTE', porEvaluar: true }), 'review');
});

test('la evaluación IA no implica que el reporte ya sea público', () => {
    assert.equal(reportPublicationState({ estado: 'PENDIENTE' }, { publicado: false, evaluacion: 'IA' }), 'pending');
    assert.equal(reportPublicationState({ estado: 'PENDIENTE' }, { evaluacion: 'IA' }), 'pending');
});

test('una emergencia pública pendiente se distingue de un incidente evaluado', () => {
    assert.equal(reportPublicationState({ estado: 'ACTIVO' }, { publicado: true, evaluacion: 'PENDIENTE' }), 'published-pending');
    assert.equal(reportPublicationState({ estado: 'ACTIVO' }, { publicado: true, evaluacion: 'IA', porEvaluar: true }), 'published-pending');
    assert.equal(reportPublicationState({ estado: 'ACTIVO' }, { publicado: true, evaluacion: 'IA', porEvaluar: false }), 'published');
});
