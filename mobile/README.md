# CiviGo Mobile — Aplicación Móvil Nativa (Android & iOS)

Aplicación móvil independiente para la plataforma **CiviGo**, desarrollada con **React, TypeScript, Vite y Capacitor**, conservando la identidad visual, el diseño y las funcionalidades del sistema original sin modificar ninguna carpeta o archivo previo del repositorio.

---

## 1. Estructura del Proyecto Móvil (`CiviGo/mobile/`)

```text
CiviGo/
├── backend/          (EXISTENTE - NO MODIFICADO)
├── frontend/         (EXISTENTE - NO MODIFICADO)
├── desktop/          (EXISTENTE - NO MODIFICADO)
└── mobile/           (NUEVA APLICACIÓN MÓVIL INDEPENDIENTE)
    ├── public/
    │   ├── iconos/                      # Iconos oficiales de incidentes viales
    │   ├── civigo-logo.jpeg             # Logotipo oficial
    │   ├── civigo-logo-animado-poster.png
    │   └── civigo-spot-poster.jpg
    ├── src/
    │   ├── assets/
    │   │   └── iconos/                  # Recursos gráficos empaquetados
    │   ├── components/
    │   │   ├── chat/
    │   │   │   └── ChatBotModal.tsx     # Asistente IA / Guía comunitaria
    │   │   ├── incident/
    │   │   │   ├── IncidentCard.tsx     # Tarjeta resumen de incidentes
    │   │   │   └── IncidentDetailModal.tsx # Hoja inferior, confirmaciones y chat comunitario
    │   │   ├── layout/
    │   │   │   ├── AuthGate.tsx         # Protección de rutas y verificación de Gmail
    │   │   │   ├── BottomNavigation.tsx # Barra inferior con botón flotante (+) para reportar
    │   │   │   └── MobileHeader.tsx     # Encabezado móvil, tema y acceso a Agente
    │   │   ├── map/
    │   │   │   ├── IncidentIcon.tsx     # Renderizado y escalado de iconos de incidentes
    │   │   │   ├── MapView.tsx          # Mapa Mapbox GL, GPS, capas y marcadores nativos
    │   │   │   └── RiskLegend.tsx       # Leyenda interactiva de niveles de riesgo
    │   │   └── navigation/
    │   │       └── RoutePlanner.tsx     # Planificación de rutas a pie, bici y auto
    │   ├── hooks/
    │   │   ├── useAuth.tsx              # Contexto de autenticación y estado offline
    │   │   ├── useGeolocation.ts        # Hook de geolocalización GPS de alta precisión
    │   │   └── useTheme.tsx             # Alternador de modo claro y oscuro persistente
    │   ├── pages/
    │   │   ├── AgentPage.tsx            # Consola operativa para Agentes (validación/clasificación)
    │   │   ├── AlertsPage.tsx           # Centro de alertas y avisos ciudadanos
    │   │   ├── CommunityPage.tsx        # Ranking mensual de aportes y tienda de recompensas
    │   │   ├── ForgotPasswordPage.tsx   # Recuperación y restablecimiento de contraseña
    │   │   ├── LoginPage.tsx            # Inicio de sesión
    │   │   ├── MapPage.tsx              # Pantalla principal con mapa, rutas y asistente
    │   │   ├── MyReportsPage.tsx        # Historial de reportes del usuario y apelaciones
    │   │   ├── ProfilePage.tsx          # Perfil, contactos, rutas favoritas y cambio de clave
    │   │   ├── RegisterPage.tsx         # Registro ciudadano con validación de Gmail
    │   │   └── ReportPage.tsx           # Creación de reporte con cámara nativa y GPS
    │   ├── services/
    │   │   ├── agent.ts                 # Operaciones de revisión y permisos de agentes
    │   │   ├── api.ts                   # Cliente HTTP adaptado para Web y Capacitor
    │   │   ├── auth.ts                  # Servicio de sesiones y autenticación
    │   │   ├── incidentIcons.ts         # Mapeo de slugs e iconos
    │   │   ├── native.ts                # Puente Capacitor (Cámara, GPS, Hápticos, Red)
    │   │   └── navigation.ts            # Cálculo de trayectos y favoritos
    │   ├── types/
    │   │   └── index.ts                 # Contratos TypeScript completos de la plataforma
    │   ├── App.tsx                      # Componente raíz con pila de navegación y botón atrás
    │   ├── index.css                    # Estilos CiviGo con variables CSS, SafeArea y temas
    │   └── main.tsx                     # Punto de entrada de React
    ├── capacitor.config.ts              # Configuración nativa de Capacitor (Android/iOS)
    ├── index.html                       # Entrypoint HTML con metadatos móviles
    ├── package.json                     # Dependencias móviles y scripts
    ├── tsconfig.json                    # Configuración TypeScript bundler
    ├── tsconfig.node.json
    ├── vite.config.ts                   # Configuración de empaquetado Vite con proxy API
    ├── .env.example                     # Plantilla de variables de entorno
    └── README.md
```

---

## 2. Funcionalidades Desarrolladas

### Rol Ciudadano
1. **Autenticación completa**: Registro con requerimiento de dirección Gmail, inicio de sesión, recuperación de contraseña por token y comprobación de correo con Google.
2. **Mapa interactivo de Ica**: Integración con Mapbox GL, visualización de alertas con iconos propios según su categoría, marcadores coloreados por nivel de riesgo (0 a 5).
3. **Planificación de rutas y navegación**: Alternativas seguras, rápidas y equilibradas para desplazamientos a pie, en bicicleta o en automóvil; visualización de advertencias ante incidentes cercanos.
4. **Reporte ciudadano in situ**:
   - Acceso a la cámara nativa mediante `@capacitor/camera` o selección desde la galería.
   - Detección automática de coordenadas GPS mediante `@capacitor/geolocation`.
   - Regla de validación de 50 metros máximos respecto al punto GPS para reportes de ubicación presencial.
   - Ajuste manual mediante mapa interactivo embebido.
5. **Mis reportes y apelaciones**: Listado con estados (Validado, Pendiente, Por evaluar, Falso) y envío de apelaciones justificadas.
6. **Comunidad y Recompensas**: Ranking mensual de usuarios destacados y catálogo de canje de puntos por recompensas.
7. **Asistente CiviGo**: Asistente conversacional contextual para resolver dudas sobre incidentes, reportes y reglas viales.
8. **Modo Claro y Oscuro**: Paleta de colores completa de CiviGo sincronizada con el dispositivo o alternable manualmente.
9. **Capacidades nativas**: Vibración háptica en botones y alertas (`@capacitor/haptics`), detección de conectividad (`@capacitor/network`) y gestión del botón físico de retroceso en Android (`@capacitor/app`).

### Rol Agente
1. **Acceso controlado**: Verificación de permisos asignados (`consultar`, `validar`, `gravedad`, `clasificar`, `resolver`, `reabrir`).
2. **Cola de incidentes**: Filtrado por distrito asignado y estado operativo.
3. **Revisión y validación**: Aprobación de reportes auténticos, reclasificación de tipos, ajuste de niveles de gravedad y declaración de falsedad con justificación obligatoria.

---

## 3. Análisis Técnico: Autenticación por Cookies y Restricciones CORS

El backend existente de CiviGo utiliza sesiones basadas en la cookie `civigo_session` con las directivas `HttpOnly`, `Path=/`, `SameSite=lax` y verificación estricta de origen en `originGuard`:

1. **En desarrollo local con navegador / Vite (`npm run dev`)**:
   `vite.config.ts` incluye un proxy inverso transparente (`server.proxy['/api']` hacia `http://127.0.0.1:4000`), lo que permite que las peticiones se realicen como `same-origin`, almacenando la cookie en el navegador sin violar CORS ni `originGuard`.

2. **En aplicación móvil nativa (Android / iOS)**:
   La configuración `capacitor.config.ts` activa los complementos `CapacitorHttp` y `CapacitorCookies`:
   ```typescript
   plugins: {
     CapacitorHttp: { enabled: true },
     CapacitorCookies: { enabled: true }
   }
   ```
   Al ejecutarse en un dispositivo móvil real o emulador Android, Capacitor intercepta las llamadas de red y las envía a través del stack de red nativo (OkHttp en Android / URLSession en iOS). Esto significa:
   - El almacenamiento de cookies `HttpOnly` se gestiona en el `CookieJar` nativo del sistema operativo.
   - Las peticiones nativas no están sujetas a las restricciones del navegador WebView.
   - Para entornos donde el backend de producción verifique el encabezado `Origin`, se recomienda agregar `https://localhost` o el esquema de la app móvil a la variable de entorno `FRONTEND_URL` en el servidor si no se utiliza el motor nativo de CapacitorHttp.

---

## 4. Instrucciones de Ejecución

### Prerrequisitos
- Node.js (v18 o superior)
- Android Studio y Android SDK (para compilar en emulador o dispositivo físico)

### A. Previsualización y pruebas en entorno de desarrollo:
```bash
cd mobile
npm install
npm run dev
```
La aplicación estará accesible en `http://localhost:5173`.

### B. Compilación y sincronización con Android:
```bash
cd mobile
npm run build
npx cap add android    # Solo la primera vez
npx cap sync           # Sincroniza los recursos web con el proyecto nativo
npx cap open android   # Abre el proyecto en Android Studio
```
Desde Android Studio, selecciona tu dispositivo físico conectado por USB o un emulador (AVD) y presiona **Run (Shift + F10)**.
