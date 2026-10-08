import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';

const {incidentTypeKey, buildIncidentFilterGroups, filterIncidentsByType} = loadTs('lib/incident-filters.ts');
const incident = (id, fields = {}) => ({
    id, tipo: 'Robo', latitud: -14, longitud: -75, estado: 'ACTIVO', nivelRiesgo: 3, totalReportes: 1, ...fields,
});
const type = (id, nombre, slug) => ({
    id, nombre, slug, emergencia: false, historico: false, fotoObligatoria: false, individual: false, ubicacionRemota: false,
});
const catalog = () => ({
    categorias: [
        {id: 1, nombre: 'Seguridad ciudadana', slug: 'seguridad-ciudadana', tipos: [type(1, 'Robo', 'robo'), type(2, 'Hurto', 'hurto')]},
        {id: 2, nombre: 'Infraestructura', slug: 'infraestructura', tipos: [type(3, 'Mala iluminación', 'mala-iluminacion')]},
        {id: 3, nombre: 'Vacía', slug: 'vacia', tipos: []},
    ],
    config: {},
});
function deepFreeze(value) {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

test('type keys normalize accents, case, whitespace and legacy names', () => {
    assert.equal(incidentTypeKey({tipo: 'Robo', tipoNombre: 'Otro', tipoSlug: '  MALA_ILUMINACIÓN  '}), 'mala-iluminacion');
    assert.equal(incidentTypeKey({tipo: 'Robo', tipoNombre: '  Intento de  ROBO '}), 'intento-de-robo');
    assert.equal(incidentTypeKey({tipo: 'MALA ILUMINACIÓN'}), 'mala-iluminacion');
    assert.equal(incidentTypeKey({tipo: 'Robo', tipoNombre: ' ', tipoSlug: ''}), 'robo');
    assert.equal(incidentTypeKey({tipo: ''}), 'sin-tipo');
});

test('catalog groups include types without reports and omit empty categories', () => {
    assert.deepEqual(buildIncidentFilterGroups(catalog(), []), [
        {key: 'seguridad-ciudadana', name: 'Seguridad ciudadana', types: [{key: 'robo', name: 'Robo'}, {key: 'hurto', name: 'Hurto'}]},
        {key: 'infraestructura', name: 'Infraestructura', types: [{key: 'mala-iluminacion', name: 'Mala iluminación'}]},
    ]);
});

test('legacy reports join existing catalog types without duplicate options', () => {
    const reports = [incident(1, {tipo: 'robo'}), incident(2, {tipo: 'ROBO', tipoNombre: ' Robo '}), incident(3, {tipo: 'MALA ILUMINACIÓN'})];
    const groups = buildIncidentFilterGroups(catalog(), reports);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.flatMap(group => group.types.map(entry => entry.key)), ['robo', 'hurto', 'mala-iluminacion']);
});

test('unknown observed types are merged into Otros incidentes without duplicates', () => {
    const reports = [
        incident(1, {tipo: 'Evento local', tipoSlug: 'evento-local'}),
        incident(2, {tipo: 'EVENTO  LOCAL'}),
        incident(3, {tipo: 'Alarma', tipoNombre: 'Árbol caído', tipoSlug: 'arbol-caido'}),
    ];
    assert.deepEqual(buildIncidentFilterGroups(catalog(), reports).at(-1), {
        key: 'otros-incidentes', name: 'Otros incidentes', types: [
            {key: 'evento-local', name: 'Evento local'}, {key: 'arbol-caido', name: 'Árbol caído'},
        ],
    });
});

test('missing catalog still supplies observed options and empty data supplies no groups', () => {
    assert.deepEqual(buildIncidentFilterGroups(null, []), []);
    assert.deepEqual(buildIncidentFilterGroups(null, [incident(1), incident(2, {tipo: 'Hurto'})]), [
        {key: 'otros-incidentes', name: 'Otros incidentes', types: [{key: 'robo', name: 'Robo'}, {key: 'hurto', name: 'Hurto'}]},
    ]);
});

test('unknown types reuse an existing Otros incidentes category instead of duplicating its group', () => {
    const data = catalog();
    data.categorias.push({id: 4, nombre: 'Otros incidentes', slug: 'otros-incidentes', tipos: [type(4, 'Alarma', 'alarma')]});
    const groups = buildIncidentFilterGroups(data, [incident(1, {tipo: 'Evento local'})]);
    assert.equal(groups.filter(group => group.key === 'otros-incidentes').length, 1);
    assert.deepEqual(groups.at(-1).types.map(entry => entry.key), ['alarma', 'evento-local']);
});

test('duplicate normalized catalog types and categories keep one option for each type', () => {
    const data = catalog();
    data.categorias.push({id: 4, nombre: 'Otra categoría', slug: 'otra', tipos: [type(4, 'ROBO', 'RÓBO')]});
    data.categorias.push({id: 5, nombre: 'Infraestructura duplicada', slug: 'INFRAESTRUCTURA', tipos: [type(5, 'Bache', 'bache')]});
    const groups = buildIncidentFilterGroups(data, [incident(1)]);
    assert.equal(groups.length, 2, 'a category containing only repeated types is omitted');
    assert.deepEqual(groups[1].types.map(entry => entry.key), ['mala-iluminacion', 'bache']);
    assert.equal(groups.flatMap(group => group.types).filter(entry => entry.key === 'robo').length, 1);
});

test('the empty type preserves the original incident array reference', () => {
    const reports = [incident(1), incident(2, {tipo: 'Hurto'})];
    assert.equal(filterIncidentsByType(reports, ''), reports);
    assert.equal(filterIncidentsByType(reports, '  '), reports);
});

test('the selected type includes newly refreshed reports and normalizes legacy values', () => {
    const first = incident(1, {tipo: 'Mala iluminación'});
    const unrelated = incident(2);
    const initial = [first, unrelated];
    assert.deepEqual(filterIncidentsByType(initial, 'mala-iluminacion'), [first]);
    const newer = incident(3, {tipo: 'Infraestructura', tipoNombre: 'Mala iluminación', tipoSlug: 'mala-iluminacion'});
    assert.deepEqual(filterIncidentsByType([...initial, newer], 'MALA ILUMINACIÓN'), [first, newer]);
    assert.deepEqual(filterIncidentsByType(initial, 'hurto'), []);
});

test('an unknown selected type stays available when its last incident is removed', () => {
    const selected = deepFreeze({key: 'evento-local', name: 'Evento local'});
    const data = deepFreeze(catalog());
    const before = buildIncidentFilterGroups(data, [incident(1, {tipo: 'Evento local'})], selected);
    assert.deepEqual(before.at(-1).types, [{key: 'evento-local', name: 'Evento local'}]);
    const after = buildIncidentFilterGroups(data, [], selected);
    assert.deepEqual(after.at(-1), {
        key: 'otros-incidentes', name: 'Otros incidentes', types: [{key: 'evento-local', name: 'Evento local'}],
    });
    assert.deepEqual(filterIncidentsByType([], selected.key), []);
    assert.equal(buildIncidentFilterGroups(data, []).some(group => group.key === 'otros-incidentes'), false);
    assert.equal(buildIncidentFilterGroups(data, [], {key: '', name: ''}).some(group => group.key === 'otros-incidentes'), false);
});

test('the preserved selection normalizes its key and reuses existing catalog or observed options', () => {
    const selected = {key: 'MALA ILUMINACIÓN', name: 'Etiqueta previa'};
    const groups = buildIncidentFilterGroups(catalog(), [], selected);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.flatMap(group => group.types).filter(entry => entry.key === 'mala-iluminacion'), [
        {key: 'mala-iluminacion', name: 'Mala iluminación'},
    ]);
    const observed = buildIncidentFilterGroups(null, [incident(1, {tipo: 'Evento local'})], {key: 'EVENTO LOCAL', name: 'Anterior'});
    assert.deepEqual(observed, [{key: 'otros-incidentes', name: 'Otros incidentes', types: [{key: 'evento-local', name: 'Evento local'}]}]);
});

test('a preserved unknown selection merges with an existing Otros incidentes category', () => {
    const data = catalog();
    data.categorias.push({id: 4, nombre: 'Otros incidentes', slug: 'otros-incidentes', tipos: [type(4, 'Alarma', 'alarma')]});
    const groups = buildIncidentFilterGroups(data, [], {key: 'EVENTO LOCAL', name: ' Evento local '});
    assert.equal(groups.filter(group => group.key === 'otros-incidentes').length, 1);
    assert.deepEqual(groups.at(-1).types, [{key: 'alarma', name: 'Alarma'}, {key: 'evento-local', name: 'Evento local'}]);
});

test('building groups and filtering never mutate frozen source data', () => {
    const data = deepFreeze(catalog());
    const reports = deepFreeze([incident(1), incident(2, {tipo: 'Evento desconocido'})]);
    const groups = buildIncidentFilterGroups(data, reports);
    const filtered = filterIncidentsByType(reports, 'robo');
    assert.equal(filtered[0], reports[0]);
    assert.notEqual(filtered, reports);
    groups[0].types.push({key: 'extra', name: 'Extra'});
    assert.equal(data.categorias[0].tipos.length, 2);
    assert.equal(reports.length, 2);
});
