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
  ...require('./guarded-ai').createGuardedAi(),
  verifyFirebaseEmail: require("./firebase-email").verifyFirebaseEmail,
  sendEmail: contacts.sendEmail,
};
