const ai = require("./ai");
const contacts = require("./contact-providers");
const { storageStatus } = require("./storage");
const { imageWebStatus, createImageWebCheck } = require("./image-web-check");

function services() {
  return {
    ia: ai.aiStatus(),
    origenImagenes: imageWebStatus(),
    ...contacts.contactServices(),
    almacenamiento: storageStatus(),
    pagos: { demo: true, configurado: false },
  };
}

module.exports = {
  services,
  ...require("./guarded-ai").createGuardedAi(),
  ...createImageWebCheck(),
  verifyFirebaseEmail: require("./firebase-email").verifyFirebaseEmail,
  sendEmail: contacts.sendEmail,
};
