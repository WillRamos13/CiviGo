const { services } = require("./providers");

// Configuration inspection only: no paid requests, messages or bucket mutations.
function integrationChecklist(env = process.env, state = services()) {
  const manual = state.telefono?.proveedor === "whatsapp-manual";
  const missing = (names) =>
    names.filter((name) => !String(env[name] || "").trim());
  return {
    alcance: "configuracion",
    conexionesProbadas: false,
    proveedores: [
      {
        id: "ia",
        nombre: "OpenAI",
        configurado:
          !!state.ia?.configurado && state.ia?.configuracionValida !== false,
        variablesPendientes:
          env.OPENAI_API_KEY?.trim() || env.AI_API_KEY?.trim()
            ? []
            : ["OPENAI_API_KEY"],
        indicacion:
          "Configura la clave privada en Railway. AI_REPORT_MODEL elige el modelo para evaluar reportes (gpt-6.1-sol por defecto); AI_CHAT_MODEL elige el del chatbot (gpt-4.1-mini por defecto). AI_MODEL sigue como alternativa compatible para ambos.",
      },
      {
        id: "telefono",
        nombre: manual ? "WhatsApp con revisión manual" : "Twilio Verify",
        configurado: !!state.telefono?.configurado,
        variablesPendientes: missing(
          manual
            ? ["WHATSAPP_VERIFICATION_NUMBER"]
            : [
                "TWILIO_ACCOUNT_SID",
                "TWILIO_AUTH_TOKEN",
                "TWILIO_VERIFY_SERVICE_SID",
              ],
        ),
        indicacion: manual
          ? "Configura PHONE_VERIFICATION_PROVIDER=whatsapp-manual y WHATSAPP_VERIFICATION_NUMBER en Railway. El usuario envía el código desde su número registrado y un administrador comprueba remitente y código antes de aprobar; no hay envío automático ni API de pago."
          : "Selecciona PHONE_VERIFICATION_PROVIDER=twilio, crea un servicio Verify y habilita los canales que usarás. La disponibilidad y aprobación de SMS/WhatsApp se comprueban en Twilio.",
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
      {
        id: "correoGoogle",
        nombre: "Correo con Google",
        configurado: !!state.correoGoogle?.configurado,
        variablesPendientes: missing(["FIREBASE_PROJECT_ID"]),
        indicacion:
          "Habilita Google en Firebase Authentication. FIREBASE_PROJECT_ID va en Railway y las cuatro variables públicas NEXT_PUBLIC_FIREBASE_* de la app web van en Vercel. Solo verifica el correo coincidente de la cuenta actual; no sustituye la sesión de CiviGo.",
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
      variables: [
        "BACKEND_URL",
        "NEXT_PUBLIC_MAPBOX_TOKEN",
        "NEXT_PUBLIC_FIREBASE_API_KEY",
        "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
        "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
        "NEXT_PUBLIC_FIREBASE_APP_ID",
      ],
      indicacion:
        "BACKEND_URL apunta a Railway. El token público de Mapbox habilita el mapa; las claves privadas permanecen en el backend.",
    },
    navegacion:
      "Las rutas y búsquedas locales usan la red de OpenStreetMap; el GPS usa los permisos del navegador.",
    pagos: "Premium y canjes permanecen en demostración, sin pagos reales.",
  };
}

module.exports = { integrationChecklist };
