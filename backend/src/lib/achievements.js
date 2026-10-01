"use strict";
function badges(validatedReports) {
  return [
    {
      id: "primer-aporte",
      nombre: "Ciudadano comprometido",
      descripcion: "Tres reportes validados",
      minimo: 3,
    },
    {
      id: "colaborador",
      nombre: "Colaborador de Ica",
      descripcion: "Diez reportes validados",
      minimo: 10,
    },
    {
      id: "comunidad",
      nombre: "Referente de la comunidad",
      descripcion: "Veinticinco reportes validados",
      minimo: 25,
    },
  ].map((b) => ({ ...b, obtenida: validatedReports >= b.minimo }));
}
module.exports = { badges };
