// Tests must replace fetch with their own deterministic mock, never use production.
globalThis.fetch = async () => {
  throw new Error('Las pruebas móviles no tienen acceso a la red. Usa un mock.');
};
