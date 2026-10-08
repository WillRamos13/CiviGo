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
        id: "trafico",
        nombre: "TomTom",
        configurado: !!env.TOMTOM_API_KEY?.trim() && env.TOMTOM_ENABLED === "true",
        variablesPendientes: [...missing(["TOMTOM_API_KEY"]), ...(env.TOMTOM_ENABLED === "true" ? [] : ["TOMTOM_ENABLED"])],
        indicacion: "Guarda TOMTOM_API_KEY únicamente en Railway y habilita TOMTOM_ENABLED=true después de aplicar las migraciones. Las cuotas se comprueban en la base. Las rutas a pie y bicicleta usan OpenStreetMap; los tiempos de tráfico compatibles se calculan para automóvil.",
      },
      {
        id: "correo",
        nombre: "Resend",
        configurado: !!state.correo?.configurado,
        variablesPendientes: missing(["RESEND_API_KEY", "EMAIL_FROM"]),
        indicacion:
          "Resend envía recordatorios, no verifica cuentas. Verifica el dominio remitente y configura EMAIL_FROM con una dirección de ese dominio.",
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
      "Más segura, más rápida y equilibrada sobre OpenStreetMap. TomTom aporta tráfico y avisos temporales sin sumar riesgo histórico. El GPS y la voz funcionan mientras la página está abierta.",
    pagos: "Premium y canjes permanecen en demostración, sin pagos reales.",
  };
}

module.exports = { integrationChecklist };
