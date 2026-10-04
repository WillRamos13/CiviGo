const ai = require("./ai");
const contacts = require("./contact-providers");
const { storageStatus } = require("./storage");

function services() {
  return {
    ia: ai.aiStatus(),
    ...contacts.contactServices(),
    almacenamiento: storageStatus(),
    pagos: { demo: true, configurado: false },
  };
}

module.exports = {
  services,
  evaluateReport: ai.evaluateReport,
  assist: ai.assist,
  requestPhone: contacts.requestPhone,
  checkPhone: contacts.checkPhone,
  sendEmail: contacts.sendEmail,
};
