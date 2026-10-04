import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { assistantHistory, assistantReply } = loadTs('lib/assistant.ts');

test('assistant replays recent complete turns without status, notices or account data', () => {
    const turns = Array.from({ length: 8 }, (_, i) => ({ pregunta: ` pregunta ${i} `, respuesta: ` respuesta ${i} `,
        modo: 'ia', ia: true, aviso: 'private diagnostic', usuarioId: 99 }));
    const history = assistantHistory(turns);
    assert.equal(history.length, 10);
    assert.deepEqual(history[0], { role: 'user', content: 'pregunta 3' });
    assert.deepEqual(history.at(-1), { role: 'assistant', content: 'respuesta 7' });
    assert.ok(history.every(item => Object.keys(item).length === 2));
});

test('assistant bounds conversation size without splitting a question from its answer', () => {
    const history = assistantHistory(Array.from({ length: 5 }, () => ({ pregunta: 'a'.repeat(1000), respuesta: 'b'.repeat(3000) })));
    assert.equal(history.length, 6);
    assert.equal(history.reduce((sum, item) => sum + item.content.length, 0), 12000);
    assert.deepEqual(history.map(item => item.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    assert.deepEqual(assistantHistory([{ pregunta: ' ', respuesta: 'ok' }, { pregunta: 'a', respuesta: 'b'.repeat(3001) }]), []);
});

test('assistant preserves the actual response mode and rejects inconsistent or broken responses', () => {
    assert.deepEqual(assistantReply({ respuesta: ' Ayuda local ', modo: 'guia', ia: false, aviso: ' Sin proveedor ' }),
        { respuesta: 'Ayuda local', modo: 'guia', ia: false, aviso: 'Sin proveedor' });
    assert.deepEqual(assistantReply({ respuesta: 'Respuesta', modo: 'ia', ia: true }), { respuesta: 'Respuesta', modo: 'ia', ia: true });
    for (const invalid of [null, {}, { respuesta: ' ', modo: 'guia', ia: false },
        { respuesta: 'Hola', modo: 'ia', ia: false }, { respuesta: 'Hola', modo: 'demo', ia: false },
        { respuesta: '<secret>'.repeat(500), modo: 'ia', ia: true }]) {
        assert.throws(() => assistantReply(invalid), error => !error.message.includes('<secret>'));
    }
});
