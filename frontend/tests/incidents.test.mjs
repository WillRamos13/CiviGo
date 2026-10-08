import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';

const { reportPublicationState } = loadTs('lib/incidents.ts');

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
