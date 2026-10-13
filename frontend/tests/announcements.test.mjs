import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { announcementLink, announcementImagePath } = loadTs('lib/announcements.ts');
test('publicidad usa rutas de imagen internas y enlaces seguros', () => {
  const imageId = '12345678-1234-1234-1234-123456789012';
  assert.equal(announcementImagePath(5, imageId), '/announcements/5/image');
  for (const id of [0,-1,1.5,Infinity]) assert.equal(announcementImagePath(id,imageId),null);
  for (const value of ['../../secret','https://example.test/image.png','data:image/png;base64,aaa']) assert.equal(announcementImagePath(5,value),null);
  assert.equal(announcementLink('/mapa','https://civigo.online'), 'https://civigo.online/mapa');
  assert.equal(announcementLink('/ranking','https://civigo.online'), 'https://civigo.online/ranking');
  assert.equal(announcementLink('https://example.test/promocion','https://civigo.online'), 'https://example.test/promocion');
  for (const value of ['//evil.test','javascript:alert(1)','http://evil.test','https://user:password@example.test','https://example.test/\\evil','/admin','/mapa?next=evil','data:text/html,hi']) assert.equal(announcementLink(value,'https://civigo.online'),null);
});
