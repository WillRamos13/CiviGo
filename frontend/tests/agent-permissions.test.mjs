import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { hasAgentPermission } = loadTs('lib/agent-permissions.ts');

test('el panel de agente muestra únicamente las decisiones concedidas', () => {
  const reader = { rol: 'AGENTE', permisos: ['consultar'] };
  assert.equal(hasAgentPermission(reader, 'consultar'), true);
  for (const key of ['validar', 'gravedad', 'clasificar', 'falsedad', 'avisos', 'resolver', 'reabrir', 'evidencia', 'moderar']) assert.equal(hasAgentPermission(reader, key), false);
  const moderator = { rol: 'AGENTE', permisos: ['moderar'] };
  assert.equal(hasAgentPermission(moderator, 'consultar'), true);
  assert.equal(hasAgentPermission(moderator, 'moderar'), true);
  assert.equal(hasAgentPermission(moderator, 'validar'), false);
});

test('las cuentas anteriores conservan decisiones sin recibir funciones nuevas', () => {
  const legacy = { rol: 'AGENTE', permisos: ['revisar'] };
  for (const key of ['consultar', 'validar', 'gravedad', 'clasificar', 'falsedad', 'avisos']) assert.equal(hasAgentPermission(legacy, key), true);
  for (const key of ['moderar', 'evidencia', 'resolver', 'reabrir', 'admin']) assert.equal(hasAgentPermission(legacy, key), false);
});

test('los roles ciudadanos, bloqueos y nombres arbitrarios no habilitan acciones de personal', () => {
  assert.equal(hasAgentPermission({ rol: 'USUARIO', permisos: ['validar'] }, 'validar'), false);
  assert.equal(hasAgentPermission({ rol: 'AGENTE', bloqueado: true, permisos: ['validar'] }, 'validar'), false);
  assert.equal(hasAgentPermission({ rol: 'AGENTE', permisos: ['admin', 'usuarios'] }, 'admin'), false);
  assert.equal(hasAgentPermission({ rol: 'ADMIN', permisos: [] }, 'validar'), true);
  assert.equal(hasAgentPermission({ rol: 'ADMIN', bloqueado: true }, 'validar'), false);
});
