import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fallo intencionado para comprobar el ejecutor', () => assert.fail('fallo esperado'));
