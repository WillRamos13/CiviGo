import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { hasAndroidFirebaseConfig } from '../android-firebase-config';

test('native Google config rejects empty, malformed and mismatched files before including the plugin', () => {
  const root = path.resolve('.local');
  mkdirSync(root, { recursive: true });
  const folder = mkdtempSync(path.join(root, 'firebase-config-test-'));
  const file = path.join(folder, 'google-services.json');
  const valid = { project_info: { project_id: 'fixture-project' }, client: [{ client_info: { android_client_info: { package_name: 'com.civigo.app' }, mobilesdk_app_id: '1:123:android:abc' }, api_key: [{ current_key: 'public-fixture-key' }] }] };
  try {
    assert.equal(hasAndroidFirebaseConfig(file, 'com.civigo.app'), false);
    for (const value of ['', '{bad-json-secret-marker', '{}', JSON.stringify({ ...valid, client: [] }), JSON.stringify(valid).replace('com.civigo.app', 'other.application'), JSON.stringify(valid).replace('public-fixture-key', '')]) {
      writeFileSync(file, value);
      assert.throws(() => hasAndroidFirebaseConfig(file, 'com.civigo.app'), error => {
        assert.match((error as Error).message, /google-services.json no es válido/);
        assert.doesNotMatch((error as Error).message, /secret-marker|public-fixture-key/);
        return true;
      });
    }
    writeFileSync(file, JSON.stringify(valid));
    assert.equal(hasAndroidFirebaseConfig(file, 'com.civigo.app'), true);
  } finally {
    if (folder.startsWith(root + path.sep)) rmSync(folder, { recursive: true, force: true });
  }
});
