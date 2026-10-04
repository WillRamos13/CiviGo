const { services } = require("./providers");

// Configuration inspection only: no paid requests, messages or bucket mutations.
function integrationChecklist(env = process.env, state = services()) {
  const missing = (names) =>
    names.filter((name) => !String(env[name] || "").trim());
  return {
    alcance: "configuracion",
    conexionesProbadas: false,
    proveedores: [
      {
        id: "ia",
        nombre: "OpenAI",
        configurado: !!state.ia?.configurado,
        variablesPendientes:
          env.OPENAI_API_KEY?.trim() || env.AI_API_KEY?.trim()
            ? []
            : ["OPENAI_API_KEY"],
        indicacion:
          "Configura la clave privada en Railway. El chatbot y la evaluación usan la misma integración; AI_MODEL permite elegir el modelo.",
      },
      {
        id: "telefono",
        nombre: "Twilio Verify",
        configurado: !!state.telefono?.configurado,
        variablesPendientes: missing([
          "TWILIO_ACCOUNT_SID",
          "TWILIO_AUTH_TOKEN",
          "TWILIO_VERIFY_SERVICE_SID",
        ]),
        indicacion:
          "Crea un servicio Verify y habilita los canales que usarás. La disponibilidad y aprobación de SMS/WhatsApp se comprueban en Twilio.",
      },
      {
        id: "correo",
        nombre: "Resend",
        configurado: !!state.correo?.configurado,
        variablesPendientes: missing(["RESEND_API_KEY", "EMAIL_FROM"]),
        indicacion:
          "Verifica el dominio remitente en Resend y configura EMAIL_FROM con una dirección de ese dominio.",
      },
      {
        id: "almacenamiento",
        nombre: "Archivos",
        configurado: !!state.almacenamiento?.configurado,
        variablesPendientes:
          state.almacenamiento?.tipo === "supabase"
            ? [
                ...missing(["SUPABASE_URL"]),
                ...(env.SUPABASE_SECRET_KEY?.trim() ||
                env.SUPABASE_SERVICE_ROLE_KEY?.trim()
                  ? []
                  : ["SUPABASE_SECRET_KEY"]),
              ]
            : [],
        indicacion:
          state.almacenamiento?.tipo === "supabase"
            ? "Usa un bucket privado de Supabase Storage. El backend valida los archivos y autoriza cada descarga."
            : "El almacenamiento local necesita un volumen persistente en Railway. Para Supabase, define STORAGE_PROVIDER=supabase y sus variables privadas.",
      },
    ].map((provider) => ({
      ...provider,
      ...(!provider.configurado && !provider.variablesPendientes.length
        ? {
            aviso:
              "Las variables están definidas, pero la configuración no es válida. Revisa su formato y las opciones del proveedor en la guía de integraciones.",
          }
        : {}),
    })),
    frontend: {
      plataforma: "Vercel",
      variables: ["BACKEND_URL", "NEXT_PUBLIC_MAPBOX_TOKEN"],
      indicacion:
        "BACKEND_URL apunta a Railway. El token público de Mapbox habilita el mapa; las claves privadas permanecen en el backend.",
    },
    navegacion:
      "Las rutas y búsquedas locales usan la red de OpenStreetMap; el GPS usa los permisos del navegador.",
    pagos: "Premium y canjes permanecen en demostración, sin pagos reales.",
  };
}

module.exports = { integrationChecklist };
