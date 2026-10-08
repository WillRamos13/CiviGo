const test = require("node:test");
const assert = require("node:assert/strict");
const { incidentConsultation } = require("../src/lib/chatbot-context");

test("incidentes actuales son el alcance predeterminado y los históricos requieren consulta explícita", () => {
  for (const query of [
    "¿Qué está pasando?",
    "¿Qué incidentes hay ahora?",
    "Rutas seguras",
    "Cuéntame los reportes",
    "¿Hay un incendio hoy?",
  ])
    assert.equal(incidentConsultation(query), "ACTUALES");
  for (const query of [
    "Incidentes históricos",
    "Antecedentes de robos",
    "¿Qué ocurrió ayer?",
    "Reportes del año pasado",
    "Robos de los últimos 2 años",
  ])
    assert.equal(incidentConsultation(query), "HISTORICOS");
  const history = [
    { role: "user", content: "Muéstrame los incidentes históricos" },
    { role: "assistant", content: "Estos son antecedentes" },
  ];
  assert.equal(incidentConsultation("¿Y los robos?", history), "HISTORICOS");
  assert.equal(incidentConsultation("¿Y ahora?", history), "ACTUALES");
  assert.equal(incidentConsultation("¿Qué está pasando?", history), "ACTUALES");
  assert.equal(incidentConsultation("Por distrito", history), "HISTORICOS");
});
