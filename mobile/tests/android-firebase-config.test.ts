import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { hasAndroidFirebaseConfig, readAndroidFirebaseProjectId } from '../android-firebase-config';

test('native Google config rejects empty, malformed and mismatched files before including the plugin', () => {
  const root = path.resolve('.local');
  mkdirSync(root, { recursive: true });
  const folder = mkdtempSync(path.join(root, 'firebase-config-test-'));
  const file = path.join(folder, 'google-services.json');
  const valid = { project_info: { project_id: 'fixture-project' }, client: [{ client_info: { android_client_info: { package_name: 'com.civigo.app' }, mobilesdk_app_id: '1:123:android:abc' }, api_key: [{ current_key: 'public-fixture-key' }], oauth_client: [{ client_type: 3, client_id: 'public-fixture-client.apps.googleusercontent.com' }] }] };
  try {
    assert.equal(hasAndroidFirebaseConfig(file, 'com.civigo.app'), false);
    assert.equal(readAndroidFirebaseProjectId(file, 'com.civigo.app'), null);
    const invalid = ['', '{bad-json-secret-marker', 'null', '{}',
      JSON.stringify({ ...valid, client: [] }),
      JSON.stringify(valid).replace('com.civigo.app', 'other.application'),
      JSON.stringify(valid).replace('public-fixture-key', ''),
      ...['UPPERCASE-project', '1starts-with-number', 'short', ' fixture-project', 'fixture-project ', 'a'.repeat(31), 'bad/script-project'].map(project_id => JSON.stringify({ ...valid, project_info: { project_id } })),
      ...[undefined, [], [{ client_type: 1, client_id: 'android-only-client' }], [{ client_type: '3', client_id: 'string-type-client' }], [{ client_type: 3, client_id: '' }], [{ client_type: 3, client_id: '   ' }], [{ client_type: 3, client_id: 123 }]].map(oauth_client => JSON.stringify({ ...valid, client: [{ ...valid.client[0], oauth_client }] })),
      JSON.stringify({ ...valid, client: [{ ...valid.client[0], oauth_client: [] }, { ...valid.client[0], client_info: { ...valid.client[0].client_info, android_client_info: { package_name: 'other.application' } } }] }),
    ];
    for (const value of invalid) {
      writeFileSync(file, value);
      for (const check of [hasAndroidFirebaseConfig, readAndroidFirebaseProjectId]) {
        assert.throws(() => check(file, 'com.civigo.app'), error => {
          assert.match((error as Error).message, /google-services.json no es válido/);
          assert.doesNotMatch((error as Error).message, /secret-marker|public-fixture-key|public-fixture-client|fixture-project/);
          return true;
        });
      }
    }
    writeFileSync(file, JSON.stringify(valid));
    assert.equal(hasAndroidFirebaseConfig(file, 'com.civigo.app'), true);
    assert.equal(readAndroidFirebaseProjectId(file, 'com.civigo.app'), 'fixture-project');
    assert.equal(typeof readAndroidFirebaseProjectId(file, 'com.civigo.app'), 'string');
  } finally {
    if (folder.startsWith(root + path.sep)) rmSync(folder, { recursive: true, force: true });
  }
});
