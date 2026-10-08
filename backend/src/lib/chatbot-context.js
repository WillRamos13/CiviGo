function normalized(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
const historicalRequest = (value) =>
  /\bhistoric[oa]s?\b|\bantecedentes\b|\bpasad[oa]s?\b|\bayer\b|\b(?:semana|mes|ano)s?\s+(?:anteriores?|pasad[oa]s?)\b|\bultimos?\s+\d+\s+(?:meses|anos)\b/.test(
    normalized(value),
  );
const currentRequest = (value) =>
  /\bahora\b|\bactual(?:es)?\b|\ben curso\b|\ben este momento\b|\bhoy\b/.test(
    normalized(value),
  );
function incidentConsultation(prompt, history = []) {
  if (historicalRequest(prompt)) return "HISTORICOS";
  if (currentRequest(prompt)) return "ACTUALES";
  // A short continuation retains the last explicit time scope. A new full
  // query defaults to current incidents instead of inheriting stale history.
  if (
    /^(?:y\b|[¿?]*\s*(?:esos|esas|cuales|cuantos|donde|por distrito|por tipo|por gravedad)\b)/.test(
      normalized(prompt).trim().replace(/^[¿?¡!]\s*/, ""),
    ) &&
    prompt.length < 160
  ) {
    for (const message of [...history].reverse()) {
      if (message.role !== "user") continue;
      if (historicalRequest(message.content)) return "HISTORICOS";
      if (currentRequest(message.content)) return "ACTUALES";
    }
  }
  return "ACTUALES";
}
module.exports = { incidentConsultation };
