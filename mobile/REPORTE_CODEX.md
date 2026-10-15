# CiviGo Mobile — informe de corrección y validación

Fecha: 15 de octubre de 2026. Repositorio: `WillRamos13/CiviGo`.

## Estado al corte

Se corrigieron los contratos, los flujos y los controles indicados en la misión dentro de `mobile/`. La corrida final aprobó **118 pruebas automatizadas y 16 comprobaciones de interfaz**. También pasaron TypeScript/Vite, la sincronización de Capacitor con ocho plugins nativos y la compilación Gradle de una APK de depuración. `npm audit --omit=dev` informó **cero vulnerabilidades en dependencias de producción**.

La aplicación no está validada completamente en Android ni contra proveedores reales. **Google sigue BLOQUEADO por configuración externa.** Spotify presenta un acceso opcional y honesto, sin reproducción simulada ni OAuth. Durante las pruebas de una compilación intermedia se comprobó la interfaz sin conexión, incluyendo Perfil y retorno al mapa. La APK definitiva se instaló y Android aceptó su lanzamiento, pero sus últimos intentos terminaron por falta de memoria en WebView. No se acredita estabilidad ni funcionamiento completo en un dispositivo.

La repetición final incluye el ajuste que libera Mapbox cuando el mapa no es visible. Se comprobó en navegador la retirada del canvas y su reconstrucción, conservando el recorrido. El apartado 8 registra la APK definitiva y el límite de la comprobación nativa.

## 1. Alcance y protección del repositorio

- Raíz verificada: `C:/Users/wills/OneDrive/Documentos/Proyectos importantes/CiviGo`.
- Rama inicial y actual: `main`.
- Commit base: `370ae1081862ad7ea05ede00c93bee4d37fbb1e3`.
- Estado inicial registrado por el coordinador: árbol de trabajo limpio; no había cambios ajenos que sobrescribir.
- Los cambios de esta misión están dentro de `mobile/`. La inspección de Git al preparar este informe no encontró cambios fuera de ese directorio.
- Se consultaron contratos de backend y referencias del frontend en modo de lectura. No se modificaron backend, frontend, desktop, raíz, `.github/`, esquemas, migraciones ni infraestructura.
- No hubo commits, push, despliegues, migraciones, canjes reales, usuarios reales de prueba ni alteraciones de producción.
- Las comprobaciones automatizadas usan transporte simulado y datos locales. La prueba de interfaz bloquea o simula las solicitudes externas; no valida proveedores de producción.

Los informes nocturnos preexistentes son antecedentes. Sus afirmaciones sobre pruebas, ingreso manual de tokens o controles Spotify no describen la implementación ni la evidencia de esta misión.

## 2. Significado de los estados

- **CORREGIDO Y VERIFICADO:** la corrección tiene evidencia local relevante. Se indica el alcance; no significa validación completa en producción.
- **CORREGIDO SIN PRUEBA COMPLETA:** existe una corrección implementada, con una parte del comportamiento todavía sin comprobar en su entorno real.
- **NO REPRODUCIBLE:** un problema revisado no pudo reproducirse. No se utiliza para presentar una prueba no ejecutada como aprobada.
- **BLOQUEADO:** falta un requisito externo que no está autorizado resolver modificando otros sistemas o usando cuentas reales.
- **PENDIENTE:** resta una comprobación o actividad concreta.

## 3. Las trece prioridades de la misión

### 1. Panel de agentes — CORREGIDO Y VERIFICADO

Se comprobó la discrepancia entre las respuestas reales y la interpretación móvil. `AgentService` normaliza tanto un arreglo como un objeto con `items`; la pantalla utiliza el contenido de la cola autorizada para el detalle y deja de depender de `/admin/incidents/:id`, una ruta inexistente.

Se alinearon filtros, parámetros y acciones con las rutas actuales. Las revisiones usan `nivelRiesgo`; se añadieron las operaciones compatibles de reclasificación, avisos, aportes y moderación de mensajes. La interfaz respeta el rol `AGENTE`, el ámbito y los permisos disponibles. Las pruebas ejercitan servicios y payloads reales con transporte aislado.

Se añadieron controles para cancelar operaciones y descartar resultados cuando cambia la cuenta, la selección o la pantalla. Las acciones reales de un agente autenticado contra el servidor no se probaron con cuentas de producción.

### 2. Verificación de Gmail — BLOQUEADO

Se eliminó la solicitud de copiar o pegar un token. El cliente ya prepara el reto del backend y utiliza Firebase web o Google Sign-In nativo para obtener automáticamente un **Firebase Auth ID token**, que es el formato esperado por el verificador del servidor. No se utiliza el `credential.idToken` OAuth de Google como sustituto.

El flujo comprueba coincidencia de Gmail y proyecto, caducidad del reto, errores de selección y limpieza de la sesión temporal. Conserva una prueba sólo en memoria para reintentar un fallo transitorio de guardado. El servidor conserva sus verificaciones de firma, proyecto, proveedor, frescura y uso único. Web prepara SDK y reto antes del clic que abre Google para mantener la activación necesaria de las ventanas emergentes.

Faltan los requisitos de configuración descritos en el apartado de bloqueos: `google-services.json`, SHA/OAuth y las cuatro variables públicas Firebase. **No se ejecutó un ingreso real con Google ni se declara completo el flujo Android.**

Sin el archivo nativo, Capacitor excluye el plugin Firebase de la APK; el resto de los ocho plugins sigue disponible. El servicio comprueba `Capacitor.isPluginAvailable` antes de importar o invocar Firebase y muestra que la verificación no está configurada. Hay una prueba específica de esta situación: no crea retos ni presenta una verificación ficticia.

### 3. Navegación GPS — CORREGIDO Y VERIFICADO

Iniciar un recorrido mantiene una vista compacta con instrucción actual y siguiente giro cuando existen, distancia restante, tiempo estimado, avisos y botón para finalizar. Los controles opcionales aparecen únicamente si el usuario los habilita. El recorrido mantiene su estado al cambiar de pestaña.

El progreso se calcula sobre la geometría de la ruta; una ubicación antigua, imprecisa o fuera del recorrido no avanza las indicaciones ni confirma llegada. El recálculo automático exige varias muestras precisas y una separación mínima entre intentos. Se conservaron los modos a pie, bicicleta y auto, la búsqueda de destinos y los favoritos.

Las pruebas de lógica y la interfaz local comprueban estas correcciones. No equivalen a conducir, pedalear o caminar un recorrido real con GPS y tráfico externos. La voz depende de la disponibilidad del sintetizador del dispositivo y empieza sólo si se activa.

Durante la comprobación nativa se reprodujo otro problema: al rechazar el aviso de precisión de Google, cambiar a Perfil y regresar al mapa volvía a abrirlo. Se preservan ahora los códigos reales del plugin y la decisión de denegación durante la sesión. El observador se cancela y no se reinicia automáticamente al volver; «Reintentar GPS» o el botón de ubicación permiten un intento explícito. Los errores temporales de GPS no bloquean el seguimiento de forma permanente. Cuatro pruebas nuevas y la comprobación integrada de interfaz cubren denegación, cambio de pestaña, liberación y reactivación manual.

### 4. Marcadores Mapbox — CORREGIDO Y VERIFICADO

Los marcadores existentes actualizan coordenadas, gravedad, icono y datos vinculados; sus eventos consultan el incidente vigente. Se conservó la construcción segura de nodos, sin insertar HTML procedente de títulos o descripciones.

Se añadieron validaciones de geometría y actualización de capas de riesgo. Los eventos del mapa y recursos gráficos se limpian al desmontar. El último ajuste libera el contexto Mapbox cuando la pestaña del mapa deja de verse y lo reconstruye al volver; la comprobación final de interfaz pasó y conserva la ruta. Así se evita mantener dos contextos gráficos al abrir el editor de ubicación de un reporte.

### 5. Autenticación y logout — CORREGIDO SIN PRUEBA COMPLETA

Cerrar sesión pone la cuenta local en `null` de inmediato. Se persiste únicamente una marca booleana de revocación pendiente, sin copiar cookies, contraseñas ni tokens de sesión a Preferences. Se reintenta la revocación antes de consultar `/users/me` o iniciar otra sesión. Login, registro y logout se coordinan para impedir que una respuesta tardía con cookie vuelva a abrir una sesión cerrada.

Las respuestas 401 invalidan contexto y caché de la sesión vigente; una respuesta antigua no invalida una sesión posterior. Un 401 al reintentar logout confirma que la cookie anterior ya no autentica. La caché offline conserva sólo datos mínimos de presentación y no concede correo verificado, permisos de agente ni capacidad de participación. Logout y caducidad eliminan el borrador privado de la cuenta, también si la pantalla de reportes está desmontada; no se borran borradores de otros usuarios.

Login y registro comprueban `/users/me` para confirmar que el dispositivo conservó la cookie y que corresponde a la misma cuenta. Se maneja la sesión restringida que el backend crea para cuentas bloqueadas. La recuperación y el cambio de contraseña invalidan de inmediato la sesión local y su caché.

Estos casos pasan pruebas aisladas, incluidas condiciones de carrera, cierre offline, reinicio, revocación fallida y cookie no conservada. **El comportamiento real del almacén HttpOnly de Android requiere todavía una prueba funcional estable en dispositivo o emulador; no se da por verificado por compilar.**

### 6. Ranking y recompensas — CORREGIDO Y VERIFICADO

Se normalizan las respuestas del backend para ranking, recompensas, saldo e historial, respetando los identificadores y cifras recibidos. No se inventan posiciones, estadísticas ni IDs como relleno. Los estados de demostración indicados por el servidor se muestran como tales.

Las rutas de consulta y canje están alineadas con los contratos actuales, con control de errores y operaciones asociadas a la cuenta vigente. Hay pruebas de servicios y una comprobación local del ranking en navegador. No se hicieron canjes reales en producción.

### 7. Evidencias de reportes — CORREGIDO Y VERIFICADO

Una categoría con fotografía obligatoria exige al menos una imagen válida; un video no la sustituye. La validación comprueba límite de tres archivos, tamaño máximo de 15 MB o el límite de video compatible del catálogo, MIME, firma inicial y decodificación real de imágenes. Se rechazan archivos vacíos, incompatibles o dañados.

Los uploads conservan el tipo esperado por el backend. Los reportes individuales requieren privacidad y se comprueba la respuesta de subida antes de crear el reporte. Si falla el envío, se intenta limpiar los adjuntos creados que siguen perteneciendo a la operación válida.

Las operaciones se vinculan a cuenta, pantalla y generación para evitar uploads o publicaciones con datos de otra cuenta después de una espera de cámara, validación o red. Las pruebas cubren cancelaciones y fallos parciales. La cámara, la galería y la lectura privada real en Android permanecen dentro de la validación funcional pendiente del dispositivo; los resultados locales no se presentan como prueba de esos proveedores.

### 8. Recursos gráficos — CORREGIDO Y VERIFICADO

Se sustituyó la referencia inexistente a `/iconos/alerta.png` por un recurso SVG presente. Se comprobaron las rutas y la normalización de iconos. El archivo se incorpora también a la distribución generada.

### 9. Spotify — CORREGIDO Y VERIFICADO; reproducción integrada BLOQUEADA

Se retiraron las canciones ficticias y los botones que simulaban reproducir, pausar o cambiar de pista. Spotify sigue desactivado por defecto y el acceso sólo aparece durante navegación cuando se habilita en el perfil. La pantalla explica el alcance y permite abrir Spotify.

El acceso y su visibilidad condicional pasan pruebas de servicio e interfaz. **No existe reproducción integrada, control de una cuenta Spotify ni OAuth validado.** Completar esa integración exige configuración, permisos y autorizaciones reales del proveedor que no estuvieron disponibles ni se suplantaron.

### 10. Mapa y errores de red — CORREGIDO Y VERIFICADO

Se muestran carga, error, modo sin conexión, reintento y hora de la última actualización. Un fallo conserva la última información recibida sin presentarla como recién actualizada.

La consulta inicial cubre la provincia y pagina de 250 en 250; se probó un conjunto de 550 incidentes sin truncarlo. El área cargada se amplía al explorar el mapa y no se reduce al viewport, evitando desapariciones al desplazarlo. No publica una página parcial como si fuera el conjunto completo. Los recientes se calculan por separado: hasta diez dentro de un kilómetro de un GPS real disponible. Se abortan o descartan respuestas antiguas y se actualiza al recuperar conexión.

Hay pruebas de contratos y de errores con transporte simulado, además de comprobaciones de interfaz local. Los datos y el estilo externos de Mapbox se simularon o bloquearon durante esa prueba, por lo que no se afirma disponibilidad real del proveedor.

### 11. Seguridad y configuración Android — CORREGIDO Y VERIFICADO

- Tráfico claro deshabilitado en Android y rechazo de API HTTP nativa. En desarrollo web sólo se permite HTTP hacia loopback.
- URLs de API restringidas al origen y al prefijo configurados; rechazo de credenciales embebidas, fragmentos, rutas de escape y esquemas ajenos.
- Evidencias restringidas a rutas de uploads del API. Su descarga autenticada valida estado, tipo, tamaño y contenido, impide redirecciones y crea recursos Blob que se liberan al cerrar o cancelar. Se detiene la reproducción antes de retirar videos.
- Se deshabilita el parche de `document.cookie`: la app utiliza la cookie HttpOnly del transporte nativo sin exponerla al código de la página. Se deshabilitan logs nativos que podrían incluir cabeceras sensibles.
- Copias de seguridad deshabilitadas y reglas de extracción añadidas. FileProvider queda limitado a rutas necesarias y se retiran permisos innecesariamente amplios.
- Variables `VITE_*` documentadas como configuración pública; no se añaden secretos. Entornos locales, caches y almacenes de firma se excluyen de Git.
- Sourcemaps de producción deshabilitados y recursos generados reconstruidos. El servidor de desarrollo escucha en loopback.
- El plugin Firebase nativo sólo se incluye si existe su configuración local; añadirla requiere repetir la sincronización Capacitor.

Las comprobaciones de configuración, contratos, cancelación y recursos pasan pruebas locales. La auditoría de dependencias de producción terminó sin vulnerabilidades reportadas. No se presenta esta revisión como una certificación integral de seguridad ni como validación funcional de todos los permisos en Android.

### 12. Pruebas automatizadas — CORREGIDO Y VERIFICADO

El runner descubre los archivos de prueba, transpila el código TypeScript real y utiliza el ejecutor de Node esperando el resultado y su código de salida. No concluye por una pausa fija. Las pruebas de control comprueban que un caso fallido, incompleto o demorado produce fallo; hay límites de tiempo. Se corrigió también el uso de URLs de archivo de Windows en la precarga del entorno.

El transporte de red está bloqueado por defecto. Los casos sustituyen únicamente los límites externos necesarios y comprueban lógica, servicios, solicitudes, recursos y efectos observables. Se retiraron comprobaciones que sólo afirmaban datos ficticios sin ejecutar la implementación.

La corrida final posterior al último ajuste de MapView aprobó **118 pruebas**, sin fallos, cancelaciones ni omisiones. La prueba de interfaz aprobó **16 comprobaciones**, incluida la liberación y reconstrucción del mapa entre pestañas.

### 13. Compilación Android — CORREGIDO Y VERIFICADO; ejecución funcional PENDIENTE

Se eliminó la dependencia de una ruta personal de Java del proyecto. Se utilizaron las herramientas locales disponibles, el wrapper de Gradle y configuración de Android compatible, sin certificados privados de publicación.

Pasaron TypeScript/Vite, `cap sync android` con ocho plugins y `assembleDebug`. Se generó una APK en:

`mobile/android/app/build/outputs/apk/debug/app-debug.apk`

La APK es de **depuración**, no una versión publicada ni firmada para distribución comercial. La instalación y la orden de inicio fueron aceptadas. Antes del último ajuste de GPS se capturó CiviGo mostrando controles y avisos sin conexión, se comprobó Perfil para visitantes y el retorno al mapa. Esas capturas pertenecen a una compilación intermedia. Tras instalar la APK definitiva, el emulador de 2 GB volvió a cerrar WebView: `dumpsys activity exit-info com.civigo.app` registra `LOW_MEMORY` para el renderer y cierre por señal del proceso de la aplicación; Logcat muestra límites de memoria de tiles y el cierre del renderer. No se observó un `FATAL` Java atribuible al inicio. La validación funcional tiene estado **CORREGIDO SIN PRUEBA COMPLETA**. El arreglo del GPS pasó pruebas de lógica y navegador, pero su confirmación visual nativa quedó bloqueada por ese cierre. El apartado 8 registra el tamaño y SHA-256 definitivos.

## 4. Mejoras adicionales

- **Registro e ingreso:** correos normalizados, nickname compatible con letras Unicode y los caracteres permitidos por el servidor, límites de formulario, autocompletado y comprobación de cookie antes de afirmar ingreso exitoso.
- **Recuperación de contraseña:** admite el enlace `/recuperar#token=...` del correo o su token opaco exacto, sin abrir enlaces pegados. Valida origen y formato, retira el secreto del historial y evita almacenarlo. Ofrece una acción explícita para volver a ingresar tras el éxito, sin navegación programada tardía.
- **Perfil:** cancela operaciones al desmontarse o cambiar de cuenta; evita continuar una solicitud con un DNI subido en otra sesión. Limpia formularios sensibles y carga favoritos y participación con control de errores.
- **Borradores:** separados por ID de cuenta, con escrituras coordinadas. El borrador global anterior no se restaura a un propietario desconocido. No se guardan GPS ni archivos multimedia en el borrador.
- **Participación en incidentes:** confirmaciones, resoluciones, avisos, chat y apelaciones respetan las rutas existentes. Las operaciones comprueban contexto antes de publicar y descartan resultados obsoletos.
- **Lectura de evidencias:** transporte autenticado y visor compatible con imágenes, video y PDF privado, con límites y limpieza de recursos. No se depende de abrir una URL privada en un navegador sin su cookie.
- **Asistente:** utiliza `/chatbot` y el historial compatible con el backend; muestra negritas, listas y código de forma segura como texto, sin ejecutar HTML ni cargar enlaces o imágenes remotas de la respuesta. Se respetan los indicadores de IA o aviso que devuelve el servidor.
- **Geolocalización y ciclo de vida:** se cancelan observadores y suscripciones aunque su registro termine después del desmontaje. Se evita actualizar una pantalla o usar un GPS pendiente después de cambiar de cuenta.
- **Navegación y riesgo:** validación de coordenadas y geometría, avisos explícitos cuando no hay riesgo confirmado o tráfico en vivo, búsqueda de destinos con control de respuestas antiguas y reintentos sin descartar el recorrido anterior válido.
- **Interfaz y accesibilidad:** nombres de controles, estados anunciables, búsqueda con opciones accesibles y controles compactos. Se probaron anchos de 320, 390, 768 y 1024 píxeles en claro y oscuro sin desbordamiento horizontal.
- **Rendimiento:** limpieza de objetos URL, reproducción, peticiones, listeners y contexto del mapa. La liberación de Mapbox al ocultarse pasó la repetición final de pruebas e interfaz.

## 5. Validaciones y evidencia

| Comprobación | Último resultado completado | Alcance y límite |
| --- | --- | --- |
| `npm test` | 118 pruebas aprobadas; 0 fallos, cancelaciones u omisiones | Código real con dependencias externas aisladas; corrida posterior al último cambio. |
| `node tests/ui-smoke.mjs` | 16 comprobaciones aprobadas, sin errores de navegador | Navegador local con API y proveedores simulados/bloqueados. |
| TypeScript y Vite | Compilación aprobada | Verifica tipos y genera distribución; no acredita funcionamiento de proveedores. |
| `npx cap sync android` | Aprobado, ocho plugins nativos | Firebase excluido al faltar `google-services.json`. |
| Gradle `assembleDebug` | Aprobado en 36 s | APK final posterior al último ajuste; 203 tareas, 20 ejecutadas y 183 al día. |
| `npm audit --omit=dev` | Cero vulnerabilidades reportadas | Dependencias de producción al momento de la consulta. |
| Instalación y lanzamiento Android | APK definitiva instalada e inicio aceptado; interfaz capturada en build intermedio | La última prueba nativa terminó por `LOW_MEMORY` de WebView. Estabilidad y flujos autenticados pendientes. |
| Inspección de Git | Cambios sólo en `mobile/` | Baseline limpio en `main`; sin commits ni push. |
| Producción y cuentas reales | Cero mutaciones de prueba | No se hicieron operaciones de proveedores con identidades reales. |

Las capturas y el resultado de la prueba de interfaz se encuentran en `mobile/.local/ui-smoke/`. Son artefactos locales ignorados por Git. `resultado.json` identifica la última corrida aprobada; el ejecutor limpia las capturas y el resultado de fallos anteriores después de una corrida aprobada. Los registros finales de pruebas, compilación, sincronización y Gradle están en `mobile/.local/*-final.log`. La evidencia Android está en `mobile/.local/emulator/`: `gps-final-exit-info.txt` y `gps-final-errors.txt` corresponden al cierre de la APK definitiva; `app-offline-final.png`, `retry-app.png` y `final-perfil.png` muestran la compilación intermedia anterior al último ajuste de GPS.

Los casos de prueba abarcan sesión y cookies, Firebase simulado, navegación y GPS, marcadores, contratos de agente y comunidad, archivos y evidencias privadas, cancelaciones por cuenta/pantalla, borradores, listeners nativos, asistente, Spotify, configuración Android y comportamiento del runner. Las pruebas de fallos intencionados del runner no representan fallos de la aplicación cuando el caso exterior comprueba correctamente su código de salida.

## 6. Bloqueos y pendientes concretos

### Google — BLOQUEADO

Para habilitar y probar el ingreso real hacen falta:

1. `mobile/android/app/google-services.json` del proyecto Firebase correcto y de la aplicación Android `com.civigo.app`.
2. Google habilitado como proveedor de Authentication y la configuración OAuth correspondiente al cliente Android y al cliente web.
3. SHA-1 del certificado de depuración registrada en ese proyecto. Una futura distribución con otra firma requerirá las huellas correspondientes; no se usaron certificados privados.
4. `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` y `VITE_FIREBASE_APP_ID` para una app web del mismo proyecto que espera el reto del backend.
5. Orígenes autorizados para la prueba web y nueva sincronización Capacitor después de agregar el archivo Android.

No se modificó Firebase ni se crearon credenciales. El backend mantiene sus validaciones.

### Spotify — BLOQUEADO para reproducción integrada

El acceso externo opcional está implementado. OAuth, autorización de cuenta, alcances y control real de reproducción no están configurados ni comprobados. No hay lista de canciones simulada presentada como reproducción actual.

### Android funcional — PENDIENTE

- Completar una prueba estable de la APK definitiva. Se verificaron instalación y orden de inicio; la interfaz offline se observó en una compilación intermedia. El cierre de WebView por memoria impide confirmar la última corrección en la interfaz nativa y acreditar estabilidad.
- Repetir la prueba en un dispositivo o emulador con recursos suficientes si persiste la falta de memoria de WebView.
- Probar cookies HttpOnly reales, login/logout/reconexión, permisos GPS, cámara/galería y visualización privada con cuentas y entorno de pruebas autorizados.
- Probar desplazamiento GPS real, navegación en los tres modos y disponibilidad de síntesis de voz.
- iOS no se compiló ni se validó en esta misión Android.

### Proveedores reales — PENDIENTE

Mapbox, búsqueda y cálculo de rutas, tráfico, envío de correo, verificación Google, reproducción Spotify y el proveedor de IA requieren su disponibilidad y configuración externas. Las pruebas locales comprueban el contrato del cliente y los estados honestos de error o indisponibilidad; no garantizan el servicio remoto. `VITE_PUBLIC_APP_URL` debe coincidir con el origen del enlace que envía el backend para recuperación.

### Alcance que esta corrección no completa — PENDIENTE

- La ruta puede presentar datos de tráfico si el backend los entrega. No se añadió una capa visual independiente de tráfico TomTom al mapa móvil.
- El modo sin conexión conserva información recibida y datos mínimos de presentación; no descarga mapas ni permite calcular nuevas rutas sin servidor.
- No se añadió un servicio de navegación permanente en segundo plano ni notificaciones push con la app cerrada.
- iOS no tiene una compilación validada aquí; requiere su proyecto nativo y un entorno macOS/Xcode.
- No se habilitaron pagos reales de Premium ni se convirtieron recompensas de demostración en canjes comerciales.
- La revisión local encontró unos 10,7 MB de geometría vial antes de estilizarla. Conviene medir memoria con esa capa real en un dispositivo de pruebas; no se atribuye el cierre del emulador a ese conjunto porque el ensayo fue sin red y no lo descargó.

Para reproducir la compilación se necesita JDK 21 y el SDK Android 35 disponibles en el entorno. Después de configurar las variables públicas: `npm ci`, `npm test`, `npm run build`, `npx cap sync android` y, desde `mobile/android/`, `./gradlew.bat :app:assembleDebug`. No quedó una ruta personal de Java fijada en el proyecto. En esta máquina se reutilizaron herramientas ya instaladas, con cachés y estado de prueba dentro de `mobile/`; no se instalaron herramientas ni se cambiaron ajustes globales.

## 7. Archivos modificados y nuevos

Inventario obtenido de `git status --porcelain=v1 --untracked-files=all` y contrastado con `git diff --name-only`. Las rutas son relativas a la raíz del repositorio. Este informe se añade al inventario como archivo nuevo. No se incluyen dependencias instaladas, caches, perfiles de prueba ni otros archivos ignorados como cambios de código.

### Código, configuración, recursos y pruebas

- `mobile/.env.example` — modificado.
- `mobile/.gitignore` — nuevo.
- `mobile/REPORTE_CODEX.md` — nuevo.
- `mobile/android/.gitignore` — modificado.
- `mobile/android/app/src/main/AndroidManifest.xml` — modificado.
- `mobile/android/app/src/main/res/xml/backup_rules.xml` — nuevo.
- `mobile/android/app/src/main/res/xml/data_extraction_rules.xml` — nuevo.
- `mobile/android/app/src/main/res/xml/file_paths.xml` — modificado.
- `mobile/android/gradle.properties` — modificado.
- `mobile/android/variables.gradle` — modificado.
- `mobile/capacitor.config.ts` — modificado.
- `mobile/index.html` — modificado.
- `mobile/package-lock.json` — modificado.
- `mobile/package.json` — modificado.
- `mobile/public/iconos/alerta.svg` — nuevo.
- `mobile/src/App.tsx` — modificado.
- `mobile/src/components/chat/AssistantReply.tsx` — nuevo.
- `mobile/src/components/chat/ChatBotModal.tsx` — modificado.
- `mobile/src/components/incident/AuthenticatedMedia.tsx` — nuevo.
- `mobile/src/components/incident/IncidentDetailModal.tsx` — modificado.
- `mobile/src/components/layout/AuthGate.tsx` — modificado.
- `mobile/src/components/map/MapView.tsx` — modificado.
- `mobile/src/components/map/incidentMarker.ts` — nuevo.
- `mobile/src/components/navigation/RoutePlanner.tsx` — modificado.
- `mobile/src/components/navigation/SpotifyNavPlayer.tsx` — modificado.
- `mobile/src/hooks/useAuth.tsx` — modificado.
- `mobile/src/hooks/useGeolocation.ts` — modificado.
- `mobile/src/hooks/useOperationScope.ts` — nuevo.
- `mobile/src/index.css` — modificado.
- `mobile/src/pages/AgentPage.tsx` — modificado.
- `mobile/src/pages/AlertsPage.tsx` — modificado.
- `mobile/src/pages/CommunityPage.tsx` — modificado.
- `mobile/src/pages/ForgotPasswordPage.tsx` — modificado.
- `mobile/src/pages/LoginPage.tsx` — modificado.
- `mobile/src/pages/MapPage.tsx` — modificado.
- `mobile/src/pages/MyReportsPage.tsx` — modificado.
- `mobile/src/pages/ProfilePage.tsx` — modificado.
- `mobile/src/pages/RegisterPage.tsx` — modificado.
- `mobile/src/pages/ReportPage.tsx` — modificado.
- `mobile/src/pages/VerifyEmailPage.tsx` — modificado.
- `mobile/src/services/agent.ts` — modificado.
- `mobile/src/services/api.ts` — modificado.
- `mobile/src/services/assistant.ts` — nuevo.
- `mobile/src/services/auth.ts` — modificado.
- `mobile/src/services/authenticatedMedia.ts` — nuevo.
- `mobile/src/services/community.ts` — nuevo.
- `mobile/src/services/firebase-email.ts` — nuevo.
- `mobile/src/services/geolocation-consent.ts` — nuevo.
- `mobile/src/services/incidentIcons.ts` — modificado.
- `mobile/src/services/incidentParticipation.ts` — nuevo.
- `mobile/src/services/mapData.ts` — nuevo.
- `mobile/src/services/media.ts` — nuevo.
- `mobile/src/services/native-lifecycle.ts` — nuevo.
- `mobile/src/services/native.ts` — modificado.
- `mobile/src/services/navigation.ts` — modificado.
- `mobile/src/services/operationScope.ts` — nuevo.
- `mobile/src/services/password-recovery.ts` — nuevo.
- `mobile/src/services/profileOperations.ts` — nuevo.
- `mobile/src/services/reportDraft.ts` — nuevo.
- `mobile/src/services/reportEvidence.ts` — nuevo.
- `mobile/src/services/roadMap.ts` — modificado.
- `mobile/src/services/spotify.ts` — modificado.
- `mobile/src/types/index.ts` — modificado.
- `mobile/tests/android-config.test.ts` — nuevo.
- `mobile/tests/assistant.test.tsx` — nuevo.
- `mobile/tests/auth.test.ts` — nuevo.
- `mobile/tests/contracts-media.test.ts` — nuevo.
- `mobile/tests/contracts-operation.test.ts` — nuevo.
- `mobile/tests/contracts.test.ts` — nuevo.
- `mobile/tests/fixtures/delayed.fixture.ts` — nuevo.
- `mobile/tests/fixtures/failed.fixture.ts` — nuevo.
- `mobile/tests/fixtures/incomplete.fixture.ts` — nuevo.
- `mobile/tests/map.test.ts` — nuevo.
- `mobile/tests/native-lifecycle.test.ts` — nuevo.
- `mobile/tests/navigation-geolocation.test.ts` — nuevo.
- `mobile/tests/navigation-profile.test.ts` — nuevo.
- `mobile/tests/navigation.test.ts` — nuevo.
- `mobile/tests/network-guard.js` — nuevo.
- `mobile/tests/report-draft.test.ts` — nuevo.
- `mobile/tests/report.test.ts` — nuevo.
- `mobile/tests/run.js` — modificado.
- `mobile/tests/runner.test.ts` — nuevo.
- `mobile/tests/services.test.ts` — modificado.
- `mobile/tests/spotify.test.ts` — nuevo.
- `mobile/tests/ui-smoke.mjs` — nuevo.
- `mobile/vite.config.ts` — modificado.

### Distribución generada

La compilación reemplaza los bundles anteriores de `mobile/dist/`, elimina sourcemaps y genera nombres con hash. La lista corresponde a la compilación final.

- `mobile/dist/assets/capacitor-vendor-oARWIe41.js` — retirado/regenerado.
- `mobile/dist/assets/capacitor-vendor-oARWIe41.js.map` — retirado/regenerado.
- `mobile/dist/assets/index-BOnNVWfZ.css` — retirado/regenerado.
- `mobile/dist/assets/index-fVQ9Eny6.js` — retirado/regenerado.
- `mobile/dist/assets/index-fVQ9Eny6.js.map` — retirado/regenerado.
- `mobile/dist/assets/lucide-vendor-DsnZY9hl.js` — retirado/regenerado.
- `mobile/dist/assets/lucide-vendor-DsnZY9hl.js.map` — retirado/regenerado.
- `mobile/dist/assets/mapbox-gl-CXtZNT3Z.js` — modificado.
- `mobile/dist/assets/mapbox-gl-CXtZNT3Z.js.map` — retirado/regenerado.
- `mobile/dist/assets/react-vendor-LulYhd5F.js` — modificado.
- `mobile/dist/assets/react-vendor-LulYhd5F.js.map` — retirado/regenerado.
- `mobile/dist/index.html` — modificado.
- `mobile/dist/assets/capacitor-vendor-BXCAKq_G.js` — nuevo.
- `mobile/dist/assets/index-CG-tP-Yw.css` — nuevo.
- `mobile/dist/assets/index-DHGhlNs3.js` — nuevo.
- `mobile/dist/assets/index.esm-FAfbWhto.js` — nuevo.
- `mobile/dist/assets/lucide-vendor-CPu6F1LZ.js` — nuevo.
- `mobile/dist/iconos/alerta.svg` — nuevo.

### Artefactos locales ignorados por Git

- `mobile/android/app/build/outputs/apk/debug/app-debug.apk`: APK de depuración generada.
- `mobile/android/app/build/outputs/apk/debug/output-metadata.json`: metadatos Android.
- `mobile/android/app/src/main/assets/public/`: recursos sincronizados para Android.
- `mobile/.local/ui-smoke/`: capturas y resultados de navegador.
- `mobile/.test-build/`, `mobile/.npm-cache/` y caches locales de compilación: auxiliares generados dentro del ámbito móvil cuando corresponde.

No se versionaron cookies, contraseñas, tokens privados, archivos de configuración personal ni almacenes de firma.

## 8. Cierre de la última validación

- **CORREGIDO Y VERIFICADO:** 118 pruebas aprobadas; 16 comprobaciones de interfaz aprobadas, 0 errores de navegador y 0 solicitudes externas permitidas por esa prueba.
- **CORREGIDO Y VERIFICADO:** TypeScript/Vite, sincronización Capacitor y Gradle después del último ajuste de Mapbox.
- **CORREGIDO Y VERIFICADO:** APK final `mobile/android/app/build/outputs/apk/debug/app-debug.apk`, **31.172.367 bytes**.
- SHA-256: `043340CB586E0DA7B52A1E84EC14FBCC44229E39F6E2F6A6051AE16ECDC78215`.
- **CORREGIDO SIN PRUEBA COMPLETA:** APK definitiva instalada en un emulador aislado Android 17/API 37, sin red ni identidades reales; Android aceptó su inicio. La última prueba terminó con `LOW_MEMORY` del renderer y cierre de la aplicación. Una compilación intermedia permitió comprobar interfaz offline, Perfil de visitante y retorno al mapa. El cambio final de GPS pasó los ensayos de lógica y navegador, pero no una comprobación nativa completa. Se requiere repetirla en un dispositivo o emulador con recursos suficientes. No se declara la aplicación estable por haber compilado.
- Se inspeccionó el contenido de la APK: sin archivos `.env`, cachés de pruebas, claves privadas ni almacenes de firma empaquetados. Se verificaron los permisos finales sin acceso amplio a la galería, permiso de cámara ni ubicación en segundo plano.
- Aislamiento final: cambios sólo en `mobile/`, sin modificación del commit base ni commits/push. Backend, frontend, desktop, base de datos e infraestructura permanecen intactos.

La compilación exitosa y las pruebas locales son evidencia del alcance descrito. No sustituyen una validación funcional completa en Android ni autorizan afirmar que todos los proveedores funcionan.
