import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { referencePhotoCredit } = loadTs('lib/reference-photo.ts');

test('una fotografía de referencia mantiene autor, licencia y página de origen segura', () => {
    assert.deepEqual(referencePhotoCredit('Foto de referencia · Bache en una calle · Autor de la foto · CC BY-SA 4.0 · https://commons.wikimedia.org/wiki/File:Pothole.jpg'), {
        caption: 'Bache en una calle', author: 'Autor de la foto', license: 'CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:Pothole.jpg',
    });
    assert.equal(referencePhotoCredit('mi-foto.jpg'), null);
});

test('los créditos no convierten campos o enlaces arbitrarios en enlaces de la página', () => {
    const prefix = 'Foto de referencia · Bache · Autor · CC BY 4.0 · ';
    for (const url of ['javascript:alert(1)', 'http://commons.wikimedia.org/wiki/File:A.jpg', 'https://commons.wikimedia.org.evil.test/wiki/File:A.jpg', 'https://usuario@commons.wikimedia.org/wiki/File:A.jpg', 'https://commons.wikimedia.org/otro']) assert.equal(referencePhotoCredit(prefix + url), null);
    assert.equal(referencePhotoCredit('Foto de referencia · incompleta'), null);
});
