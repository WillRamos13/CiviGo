import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import config from '../capacitor.config';

test('Android conserva HTTPS, cookies nativas sin exponer document.cookie y Google real', () => {
  assert.equal(config.server?.cleartext, false);
  assert.equal(config.plugins?.CapacitorHttp.enabled, true);
  assert.equal(config.plugins?.CapacitorCookies.enabled, false);
  assert.deepEqual(config.plugins?.FirebaseAuthentication.providers, ['google.com']);
  assert.ok(config.android?.includePlugins?.includes('@capacitor/geolocation'));
  assert.equal(config.loggingBehavior, 'none');
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE|READ_MEDIA_IMAGES|READ_MEDIA_VIDEO|ACCESS_BACKGROUND_LOCATION/);
  assert.match(manifest, /ACCESS_FINE_LOCATION/);
  for (const name of ['backup_rules.xml', 'data_extraction_rules.xml']) {
    const xml = readFileSync(`android/app/src/main/res/xml/${name}`, 'utf8');
    assert.match(xml, /exclude domain="database"/);
    assert.match(xml, /exclude domain="sharedpref"/);
  }
});
test('Gradle no fija un JDK de una computadora y el zoom accesible no está bloqueado', () => {
  assert.doesNotMatch(readFileSync('android/gradle.properties', 'utf8'), /org\.gradle\.java\.home/);
  assert.doesNotMatch(readFileSync('index.html', 'utf8'), /user-scalable=no|maximum-scale=1/);
});
