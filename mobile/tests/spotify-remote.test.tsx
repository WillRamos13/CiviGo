import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpotifyRemoteController, disconnectedSpotifyState, parseSpotifyState, type SpotifyRemoteDriver, type SpotifyPlaybackState } from '../src/services/spotifyRemote';
import { SpotifyPlaybackCard, SpotifyConnectionNotice } from '../src/components/navigation/SpotifyNavPlayer';

const live = (name = 'Pista real del fixture', paused = false): SpotifyPlaybackState => ({ connected: true, paused, updatedAt: 1000, positionMs: 2000, canSkipNext: true, canSkipPrevious: false, track: { name, artist: 'Artista del fixture', uri: 'spotify:track:abc123', durationMs: 180000 } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(next => { resolve = next; }); return { promise, resolve }; };
function driver(options: { configured?: boolean; supported?: boolean; installed?: boolean } = {}) {
  const calls: string[] = [];
  const callbacks: ((state: unknown) => void)[] = [];
  const value: SpotifyRemoteDriver = {
    supported: () => options.supported ?? true,
    capabilities: async () => { calls.push('capabilities'); return { platform: 'android', configured: options.configured ?? true, installed: options.installed ?? true, connected: false }; },
    setEnabled: async ({ enabled }) => { calls.push(`enabled:${enabled}`); },
    connect: async ({ userInitiated }) => { calls.push(`connect:${userInitiated}`); return live(); },
    disconnect: async () => { calls.push('disconnect'); },
    command: async ({ action }) => { calls.push(action); },
    getState: async () => live(),
    addListener: async (name, callback) => { calls.push(name); callbacks.push(callback); return { remove: async () => { calls.push('remove-listener'); } }; },
  };
  return { value, calls, callbacks };
}

test('a disabled Spotify controller does not query, subscribe, connect or request authorization', async () => {
  const fixture = driver(), controller = new SpotifyRemoteController(fixture.value);
  assert.deepEqual(controller.snapshot(), disconnectedSpotifyState());
  assert.deepEqual(fixture.calls, []);
  await assert.rejects(controller.connect(false), /botón/);
  assert.deepEqual(fixture.calls, []);
});

test('missing native support, configuration or Spotify installation never starts authentication', async () => {
  for (const options of [{ supported: false }, { configured: false }, { installed: false }]) {
    const fixture = driver(options), controller = new SpotifyRemoteController(fixture.value);
    await assert.rejects(controller.connect(true), options.installed === false ? /Instala/ : /configurada/);
    assert.ok(!fixture.calls.some(call => call.startsWith('connect:') || call === 'enabled:true' || call === 'playerState'));
    assert.equal(controller.snapshot().connected, false);
  }
});

test('explicit connection obtains actual SDK state and playback commands never toggle UI optimistically', async () => {
  const fixture = driver(), controller = new SpotifyRemoteController(fixture.value);
  await controller.connect(true);
  assert.equal(controller.snapshot().track?.name, 'Pista real del fixture');
  await controller.command('pause');
  assert.equal(controller.snapshot().paused, false, 'a successful request is not proof of paused playback');
  fixture.callbacks[0](live('Pista real del fixture', true));
  assert.equal(controller.snapshot().paused, true);
  await controller.command('resume');
  assert.equal(controller.snapshot().paused, true, 'wait for native state');
  await controller.command('next');
  await assert.rejects(controller.command('previous'), /no permite/);
  assert.equal(fixture.calls.filter(call => call === 'previous').length, 0);
  fixture.callbacks[0](live('Siguiente pista confirmada', false));
  assert.equal(controller.snapshot().track?.name, 'Siguiente pista confirmada');
  await controller.disconnect();
  assert.equal(controller.snapshot().connected, false);
  assert.ok(fixture.calls.includes('remove-listener'));
});

test('disconnect wins over delayed connection, late metadata and subsequent playback commands', async () => {
  const fixture = driver(), pending = deferred<unknown>(), controller = new SpotifyRemoteController(fixture.value);
  const connecting = deferred<void>();
  fixture.value.connect = async () => { connecting.resolve(); return pending.promise; };
  const connection = controller.connect(true);
  await connecting.promise;
  await controller.disconnect();
  fixture.callbacks[0](live('Respuesta de sesión anterior'));
  pending.resolve(live('Conexión tardía'));
  await connection;
  assert.equal(controller.snapshot().track, null);
  await assert.rejects(controller.command('resume'), /Conecta/);
  assert.equal(fixture.calls.includes('resume'), false);
});

test('reconnection removes old listener and ignores old-account callback generation', async () => {
  const fixture = driver(), controller = new SpotifyRemoteController(fixture.value);
  await controller.connect(true);
  fixture.callbacks[0]({ connected: false });
  await controller.connect(true);
  assert.equal(fixture.calls.filter(call => call === 'remove-listener').length, 1);
  fixture.callbacks[0](live('Callback obsoleto'));
  assert.notEqual(controller.snapshot().track?.name, 'Callback obsoleto');
  fixture.callbacks[1](live('Callback vigente'));
  assert.equal(controller.snapshot().track?.name, 'Callback vigente');
  await controller.disconnect();
});

test('connect response cannot overwrite newer subscription metadata with a provisional state', async () => {
  const fixture = driver(), controller = new SpotifyRemoteController(fixture.value);
  fixture.value.connect = async () => {
    fixture.callbacks[0]({ ...live('Suscripción reciente'), updatedAt: 5000 });
    return { ...live('Estado anterior'), track: null, updatedAt: 0 };
  };
  await controller.connect(true);
  assert.equal(controller.snapshot().track?.name, 'Suscripción reciente');
  await controller.disconnect();
});

test('failed connection cleans up authorization resources and permits a later explicit retry', async () => {
  const fixture = driver(), controller = new SpotifyRemoteController(fixture.value);
  fixture.value.connect = async () => { throw new Error('Autorización cancelada'); };
  await assert.rejects(controller.connect(true), /cancelada/);
  assert.equal(controller.snapshot().connected, false);
  assert.ok(fixture.calls.includes('remove-listener'));
  fixture.value.connect = async () => live();
  await controller.connect(true);
  assert.equal(controller.snapshot().connected, true);
  await controller.disconnect();
});

test('Spotify data never imports remote artwork URLs, scripts, negative positions or malformed tracks', () => {
  const parsed = parseSpotifyState({ ...live(), track: { ...live().track, artwork: 'https://tracker.invalid/cover' } });
  assert.equal(parsed.track?.artwork, undefined);
  const local = parseSpotifyState({ ...live(), track: { ...live().track, artwork: 'data:image/jpeg;base64,YWJj' } });
  assert.equal(local.track?.artwork, 'data:image/jpeg;base64,YWJj');
  assert.throws(() => parseSpotifyState({ ...live(), positionMs: -1 }), /válido/);
  assert.throws(() => parseSpotifyState({ ...live(), track: { ...live().track, uri: 'javascript:alert(1)' } }), /válida/);
  assert.throws(() => parseSpotifyState({ ...live(), track: { ...live().track, durationMs: Infinity } }), /válida/);
  assert.deepEqual(parseSpotifyState({ connected: false, track: live().track }), disconnectedSpotifyState());
});

test('Spotify controls reflect real native restrictions and never appear in unconfigured notice', () => {
  const html = renderToStaticMarkup(<SpotifyPlaybackCard playback={live()} compact onCommand={() => {}} onDisconnect={() => {}} />);
  for (const text of ['Pista real del fixture', 'Artista del fixture', 'Pausar Spotify', 'Siguiente pista en Spotify', 'Pista anterior en Spotify']) assert.ok(html.includes(text), text);
  assert.match(html, /aria-label="Pista anterior en Spotify" disabled/);
  const notice = renderToStaticMarkup(<SpotifyConnectionNotice capabilities={{ platform: 'android', configured: false, installed: true, connected: false }} onConnect={() => {}} />);
  assert.ok(notice.includes('aún no está disponible'));
  assert.ok(!notice.includes('Conectar Spotify'));
  assert.ok(!notice.includes('Pausar Spotify'));
});
