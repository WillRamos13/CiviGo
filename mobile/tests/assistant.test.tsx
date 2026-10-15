import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assistantMarkdown, askAssistant } from '../src/services/assistant';
import { AssistantReply } from '../src/components/chat/AssistantReply';

test('asistente presenta párrafos, negritas y listas sin ejecutar HTML remoto', () => {
  const html = renderToStaticMarkup(<AssistantReply text={'**CiviGo**\n\n- Primero\n- Segundo\n\n<img src=x onerror=alert(1)>'} />);
  assert.match(html, /<strong>CiviGo<\/strong>/);
  assert.match(html, /<ul/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|\*\*CiviGo/);
  assert.equal(assistantMarkdown('a'.repeat(4000))[0].kind, 'paragraph');
});
test('consulta usa contrato real, limita historial a 5 turnos y transmite cancelación', async () => {
  const prior = globalThis.fetch;
  const controller = new AbortController();
  let body: any;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(String(url)).pathname, '/api/chatbot');
    assert.equal(options?.credentials, 'include');
    body = JSON.parse(String(options?.body));
    return Response.json({ respuesta: 'Guía de CiviGo', ia: false, aviso: 'Sin IA' });
  };
  try {
    const answer = await askAssistant('  ¿Cómo reporto?  ', Array.from({ length: 8 }, (_, n) => ({ pregunta: `${n}`, respuesta: 'r' })), controller.signal);
    assert.equal(body.mensaje, '¿Cómo reporto?');
    assert.equal(body.historial.length, 5);
    assert.equal(body.historial[0].pregunta, '3');
    assert.equal(answer.ia, false);
    assert.equal(answer.aviso, 'Sin IA');
    controller.abort();
    await assert.rejects(askAssistant('reintento', [], controller.signal), { name: 'AbortError' });
    await assert.rejects(askAssistant('a'.repeat(1001), []), /1000/);
  } finally { globalThis.fetch = prior; }
});
test('respuesta incompleta no se hace pasar por una respuesta correcta', async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = async () => Response.json({});
  try { await assert.rejects(askAssistant('ayuda', []), /No se recibió/); }
  finally { globalThis.fetch = prior; }
});
