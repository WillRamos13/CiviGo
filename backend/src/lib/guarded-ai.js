const ai = require('./ai');
const { reserveAiRequest } = require('./ai-usage');

function createGuardedAi({ adapter = ai, reserve = purpose => reserveAiRequest(require('./db'), purpose) } = {}) {
  function diagnostic(purpose, reason) {
    try { console.warn(`[CiviGo IA] servicio=${purpose} motivo=${reason}`); }
    catch { /* Logging cannot break the local guide or human review. */ }
  }
  async function run(purpose, work) {
    const configured = adapter.aiStatus()[purpose === 'chat' ? 'chatConfigurado' : 'reportesConfigurado'];
    // No database reservation is necessary when no external request can run.
    if (configured) {
      let allowed;
      try { allowed = await reserve(purpose); }
      catch {
        diagnostic(purpose, 'CONTADOR_NO_DISPONIBLE');
        return null;
      }
      if (!allowed) {
        diagnostic(purpose, 'CUOTA_SOLICITUDES');
        return null;
      }
    }
    // Failed provider calls consume their reservation too: a timeout does not
    // prove that the provider did not process or bill the request.
    return work();
  }
  return {
    evaluateReport: (report, type) => run('reportes', () => adapter.evaluateReport(report, type)),
    assist: (prompt, context, history) => run('chat', () => adapter.assist(prompt, context, history)),
  };
}

module.exports = { createGuardedAi };
