import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpotifyService } from '../src/services/spotify';
import { StorageService } from '../src/services/native';
import { SpotifyNavPlayer, SpotifyConnectionNotice } from '../src/components/navigation/SpotifyNavPlayer';

test('Spotify preference is off until explicitly enabled and persistence failure remains off', async () => {
  const originalGet = StorageService.get;
  const originalSet = StorageService.set;
  const storage = new Map<string, string>();
  try {
    StorageService.get = async (key) => storage.get(key) ?? null;
    StorageService.set = async (key, value) => { storage.set(key, value); };
    assert.equal(await SpotifyService.isEnabled(), false);
    assert.equal(renderToStaticMarkup(React.createElement(SpotifyNavPlayer, { isNavigating: true })), '');
    await SpotifyService.setEnabled(true);
    assert.equal(await SpotifyService.isEnabled(), true);
    await SpotifyService.setEnabled(false);
    assert.equal(await SpotifyService.isEnabled(), false);
    StorageService.set = async () => { throw new Error('Storage unavailable'); };
    await assert.rejects(() => SpotifyService.setEnabled(true), /Storage unavailable/);
    assert.equal(await SpotifyService.isEnabled(), false);
    StorageService.get = async () => { throw new Error('Storage unavailable'); };
    assert.equal(await SpotifyService.isEnabled(), false);
  } finally { StorageService.get = originalGet; StorageService.set = originalSet; }
});

test('explicit Spotify open performs one user-requested launch, no delayed extra window', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const calls: unknown[][] = [];
  try {
    Object.defineProperty(globalThis, 'window', { value: { open: (...args: unknown[]) => { calls.push(args); } }, configurable: true });
    SpotifyService.openSpotify();
    assert.deepEqual(calls, [['https://open.spotify.com', '_blank', 'noopener,noreferrer']]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original); else delete (globalThis as any).window;
  }
});

test('enabled Spotify renders honest disconnected state and no pretend playback controls', () => {
  const html = renderToStaticMarkup(React.createElement(SpotifyConnectionNotice));
  assert.ok(html.includes('Spotify sin conectar'));
  assert.ok(html.includes('No hay una conexión autorizada'));
  assert.ok(html.includes('Abrir Spotify'));
  for (const fake of ['Reproducir', 'Pausar', 'Siguiente pista', 'Ruta Segura CiviGo']) assert.equal(html.includes(fake), false);
});

test('persisted opt-in updates an already mounted navigation subscription and disposes cleanly', async () => {
  const originalSet = StorageService.set;
  const values: boolean[] = [];
  const unsubscribe = SpotifyService.subscribe(value => values.push(value));
  try {
    StorageService.set = async () => {};
    await SpotifyService.setEnabled(true);
    await SpotifyService.setEnabled(false);
    assert.deepEqual(values, [true, false]);
    StorageService.set = async () => { throw new Error('No storage'); };
    await assert.rejects(SpotifyService.setEnabled(true), /No storage/);
    assert.deepEqual(values, [true, false]);
    unsubscribe();
    StorageService.set = async () => {};
    await SpotifyService.setEnabled(true);
    assert.deepEqual(values, [true, false]);
  } finally { unsubscribe(); StorageService.set = originalSet; }
});
