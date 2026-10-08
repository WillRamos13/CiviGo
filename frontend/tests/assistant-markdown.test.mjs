import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { assistantMarkdown, assistantInline } = loadTs('lib/assistant-markdown.ts');

test('el asistente conserva espacios y convierte negritas y listas en tokens de texto', () => {
    assert.deepEqual(assistantMarkdown('Hay **3 incidentes** activos.\n\n- **Robo** en Ica\n- Incendio\n\nConsulta el mapa.'), [
        { kind: 'paragraph', content: [{ kind: 'text', text: 'Hay ' }, { kind: 'strong', text: '3 incidentes' }, { kind: 'text', text: ' activos.' }] },
        { kind: 'list', ordered: false, items: [[{ kind: 'strong', text: 'Robo' }, { kind: 'text', text: ' en Ica' }], [{ kind: 'text', text: 'Incendio' }]] },
        { kind: 'paragraph', content: [{ kind: 'text', text: 'Consulta el mapa.' }] },
    ]);
    assert.equal(assistantMarkdown('Línea uno\nLínea dos')[0].content[0].text, 'Línea uno Línea dos');
    assert.equal(assistantMarkdown('1. Selecciona destino\n2. Inicia')[0].ordered, true);
});

test('HTML, URLs e imágenes se conservan como texto sin contenido ejecutable', () => {
    const source = '<img src=x onerror="alert(1)">\n\n[enlace](javascript:alert(1))\n![imagen](https://example.test/a.png)';
    const blocks = assistantMarkdown(source);
    assert.equal(blocks.every(block => block.kind === 'paragraph'), true);
    assert.equal(blocks[0].content[0].text, '<img src=x onerror="alert(1)">');
    assert.ok(blocks[1].content[0].text.includes('javascript:'));
    assert.equal(blocks.some(block => ['html', 'image', 'link'].includes(block.kind)), false);
    assert.deepEqual(assistantInline('**<script>alert(1)</script>**'), [{ kind: 'strong', text: '<script>alert(1)</script>' }]);
});

test('marcas incompletas no pierden contenido y el parser limita respuestas', () => {
    assert.deepEqual(assistantInline('Texto **sin cerrar'), [{ kind: 'text', text: 'Texto **sin cerrar' }]);
    assert.equal(assistantMarkdown('a'.repeat(10000))[0].content[0].text.length, 3000);
    assert.deepEqual(assistantMarkdown(''), []);
});

test('la respuesta real de React presenta negritas y listas escapando HTML', () => {
    const nativeRequire = createRequire(import.meta.url);
    const source = ts.transpileModule(fs.readFileSync('components/AssistantReply.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const loadedModule = { exports: {} };
    vm.runInNewContext(source, { module: loadedModule, exports: loadedModule.exports, require: name => name === '@/lib/assistant-markdown' ? { assistantMarkdown } : name.endsWith('.css') ? { reply: 'assistant-reply' } : nativeRequire(name) });
    const markup = renderToStaticMarkup(React.createElement(loadedModule.exports.default, { text: '**Robo** en Ica.\n\n- <img src=x onerror="alert(1)">\n- [enlace](javascript:alert(1))' }));
    assert.ok(markup.includes('<strong>Robo</strong> en Ica.'));
    assert.ok(markup.includes('<ul><li>'));
    assert.ok(markup.includes('&lt;img'));
    assert.equal(markup.includes('<img'), false);
    assert.equal(markup.includes('<a '), false);
    assert.equal(markup.includes('**Robo**'), false);
});
