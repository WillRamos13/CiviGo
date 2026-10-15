# CiviGo Mobile — informe de corrección y validación

Fecha: 15 de octubre de 2026. Repositorio: `WillRamos13/CiviGo`.

## Estado al corte

Se corrigieron los contratos, los flujos y los controles indicados en la misión dentro de `mobile/`. La corrida final aprobó **142 pruebas automatizadas y 25 comprobaciones de interfaz** (20 generales y 5 de navegación). También pasaron TypeScript/Vite, la sincronización de Capacitor con ocho plugins nativos y la compilación Gradle de una APK de depuración. `npm audit --omit=dev` informó **cero vulnerabilidades en dependencias de producción**.

La aplicación no está validada completamente en Android ni contra proveedores reales. **Google sigue BLOQUEADO por configuración externa.** Spotify presenta un acceso opcional y honesto, sin reproducción simulada ni OAuth. En la primera revisión se observó la interfaz sin conexión de una compilación intermedia. La APK de esta segunda auditoría se instaló y Android aceptó su lanzamiento, pero el emulador, esta vez con 3 GB comprobados, volvió a cerrar WebView por memoria y mostró «System UI isn't responding». No se acredita estabilidad ni funcionamiento completo en un dispositivo. El detalle de esta revisión está en el apartado 9.

La repetición final incluye la liberación del mapa oculto y las correcciones de la segunda auditoría. Se comprobó en navegador la retirada del canvas y su reconstrucción, conservando el recorrido. El apartado 8 registra la APK vigente y el límite de la comprobación nativa.

## 1. Alcance y protección del repositorio

- Raíz verificada: `C:/Users/wills/OneDrive/Documentos/Proyectos importantes/CiviGo`.
- Rama inicial y actual: `main`.
- Commit de referencia de la primera auditoría: `370ae1081862ad7ea05ede00c93bee4d37fbb1e3`. Al iniciar la segunda revisión se observó el commit `bd6907ea609e7c001fa7f2c05f3fff05e98e8751` (`ejemplo`), que incorporó el trabajo anterior. Se conservó ese estado; este agente no ejecutó commits ni push.
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

La corrida final posterior al último ajuste de MapView aprobó **142 pruebas**, sin fallos, cancelaciones ni omisiones. La prueba de interfaz aprobó **20 comprobaciones**, incluida la liberación y reconstrucción del mapa entre pestañas.

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
| `npm test` | 142 pruebas aprobadas; 0 fallos, cancelaciones u omisiones | Código real con dependencias externas aisladas; corrida posterior al último cambio. |
| `node tests/ui-smoke.mjs` | 20 comprobaciones aprobadas, sin errores de navegador | Navegador local con API y proveedores simulados/bloqueados. |
| `node tests/navigation-ui-smoke.mjs` | 5 comprobaciones aprobadas | Componentes reales con adaptadores aislados; sin llamadas externas. |
| TypeScript y Vite | Compilación aprobada | Verifica tipos y genera distribución; no acredita funcionamiento de proveedores. |
| `npx cap sync android` | Aprobado, ocho plugins nativos | Firebase excluido al faltar `google-services.json`. |
| Gradle `assembleDebug` | Aprobado en 1 min 21 s | APK final posterior al último ajuste; 203 tareas, 20 ejecutadas y 183 al día. |
| `npm audit --json` | Cero vulnerabilidades reportadas | Consulta de la segunda auditoría, incluidas dependencias de desarrollo. |
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

- `mobile/REPORTE_CODEX.md` — modificado.
- `mobile/src/App.tsx` — modificado.
- `mobile/src/components/chat/ChatBotModal.tsx` — modificado.
- `mobile/src/components/incident/IncidentDetailModal.tsx` — modificado.
- `mobile/src/components/incident/IncidentFromAlert.tsx` — nuevo.
- `mobile/src/components/map/MapView.tsx` — modificado.
- `mobile/src/components/navigation/RoutePlanner.tsx` — modificado.
- `mobile/src/hooks/useDialog.ts` — nuevo.
- `mobile/src/hooks/useTheme.tsx` — modificado.
- `mobile/src/pages/AgentPage.tsx` — modificado.
- `mobile/src/pages/LoginPage.tsx` — modificado.
- `mobile/src/pages/ProfilePage.tsx` — modificado.
- `mobile/src/pages/RegisterPage.tsx` — modificado.
- `mobile/src/services/agent.ts` — modificado.
- `mobile/src/services/auth.ts` — modificado.
- `mobile/src/services/backNavigation.ts` — nuevo.
- `mobile/src/services/firebase-email.ts` — modificado.
- `mobile/src/services/geolocation-consent.ts` — modificado.
- `mobile/src/services/incidentDetails.ts` — nuevo.
- `mobile/src/services/incidentMessages.ts` — nuevo.
- `mobile/src/services/incidentParticipation.ts` — modificado.
- `mobile/src/services/mapData.ts` — modificado.
- `mobile/src/services/native.ts` — modificado.
- `mobile/src/services/navigation.ts` — modificado.
- `mobile/src/services/theme.ts` — nuevo.
- `mobile/tests/auth-pages.test.ts` — nuevo.
- `mobile/tests/auth.test.ts` — modificado.
- `mobile/tests/back-theme-details.test.ts` — nuevo.
- `mobile/tests/contracts-operation.test.ts` — modificado.
- `mobile/tests/contracts.test.ts` — modificado.
- `mobile/tests/incident-messages.test.ts` — nuevo.
- `mobile/tests/map.test.ts` — modificado.
- `mobile/tests/navigation-geolocation.test.ts` — modificado.
- `mobile/tests/navigation-ui-smoke.mjs` — nuevo.
- `mobile/tests/navigation.test.ts` — modificado.
- `mobile/tests/ui-smoke.mjs` — modificado.

### Distribución generada

Recursos generados por la compilación final; los bundles anteriores y sus sourcemaps se sustituyeron por esta distribución.

- `mobile/dist/assets/index-BTcGYmyn.js` — nuevo.
- `mobile/dist/assets/index-DHGhlNs3.js` — retirado/regenerado.
- `mobile/dist/assets/lucide-vendor-BX3kr-sO.js` — nuevo.
- `mobile/dist/assets/lucide-vendor-CPu6F1LZ.js` — retirado/regenerado.
- `mobile/dist/index.html` — modificado.

### Artefactos locales ignorados por Git

- `mobile/android/app/build/outputs/apk/debug/app-debug.apk`: APK de depuración generada.
- `mobile/android/app/build/outputs/apk/debug/output-metadata.json`: metadatos Android.
- `mobile/android/app/src/main/assets/public/`: recursos sincronizados para Android.
- `mobile/.local/ui-smoke/`: capturas y resultados de navegador.
- `mobile/.test-build/`, `mobile/.npm-cache/` y caches locales de compilación: auxiliares generados dentro del ámbito móvil cuando corresponde.

No se versionaron cookies, contraseñas, tokens privados, archivos de configuración personal ni almacenes de firma.

## 8. Cierre de la última validación

- **CORREGIDO Y VERIFICADO:** 142 pruebas aprobadas; 25 comprobaciones de interfaz aprobadas (20 generales y 5 de navegación), 0 errores de navegador y 0 solicitudes externas permitidas por esas pruebas.
- **CORREGIDO Y VERIFICADO:** TypeScript/Vite, sincronización Capacitor y Gradle después del último ajuste de Mapbox.
- **CORREGIDO Y VERIFICADO:** APK final `mobile/android/app/build/outputs/apk/debug/app-debug.apk`, **31.172.367 bytes**.
- SHA-256: `3563926D2BF9C289C68CAFFF4BEB972E42AF48C7E583E7182D6C781DB175D227`.
- **CORREGIDO SIN PRUEBA COMPLETA:** APK vigente instalada en un emulador aislado Android 17/API 37 con 3 GB (3.043.484 kB en `/proc/meminfo`), sin red ni identidades reales; Android aceptó su inicio. La prueba terminó con `LOW_MEMORY` del renderer, cierre de la aplicación y un aviso de que System UI no respondía. En la primera auditoría una compilación intermedia permitió comprobar interfaz offline, Perfil de visitante y retorno al mapa. Los cambios actuales pasaron pruebas de lógica y navegador, pero no una comprobación nativa completa. Se requiere repetirla en otro dispositivo o emulador estable. No se declara la aplicación estable por haber compilado.
- Se inspeccionó el contenido de la APK: sin archivos `.env`, cachés de pruebas, claves privadas ni almacenes de firma empaquetados. Se verificaron los permisos finales sin acceso amplio a la galería, permiso de cámara ni ubicación en segundo plano.
- Aislamiento final: cambios sólo en `mobile/`, sin commits/push ejecutados por este agente. Se conserva el commit observado `bd6907e` y el trabajo previo. Backend, frontend, desktop, base de datos e infraestructura no fueron modificados por esta revisión.

La compilación exitosa y las pruebas locales son evidencia del alcance descrito. No sustituyen una validación funcional completa en Android ni autorizan afirmar que todos los proveedores funcionan.

## 9. Segunda auditoría y correcciones aplicadas — 15 de octubre de 2026

Esta revisión partió del trabajo de la primera auditoría, sin revertirlo. Antes de editar se inspeccionó Git y se guardaron hashes de los archivos en `.local/audit-2026-10-15-v2/baseline-hashes.json`. El commit `bd6907e`, observado en esta revisión e incorporado fuera de las acciones del agente, contiene el trabajo anterior. Las 118 pruebas existentes pasaron como referencia inicial. Se revisaron los contratos actuales del backend en modo de lectura y se reprodujeron los fallos antes de aplicar las correcciones.

| Hallazgo o mejora | Corrección aplicada | Evidencia y estado |
| --- | --- | --- |
| Un reset de contraseña tardío cerraba una sesión iniciada posteriormente | Reset, cambio de contraseña, login y logout comparten la cola que ordena respuestas que cambian la cookie | Carreras y cancelaciones diferidas: CORREGIDO Y VERIFICADO localmente |
| Volver durante login o registro dejaba la cookie y la interfaz con cuentas distintas | Se sincroniza el proveedor de sesión aunque la pantalla haya salido; sólo se cancela su navegación y mensajes | Páginas y proveedor reales con respuestas retrasadas, incluidos usuarios bloqueados: CORREGIDO Y VERIFICADO |
| Una verificación Google cancelada podía abrir el proveedor después de esperar en cola | Se invalida la adquisición y se comprueba su generación antes de abrir Google o leer su token | Puente nativo sustituido en la prueba, sin acceder a Google: CORREGIDO Y VERIFICADO en lógica; configuración real sigue BLOQUEADA |
| El primer voto ciudadano se anunciaba como resolución definitiva | Mensaje, estado, contadores y disponibilidad del chat respetan la respuesta del mismo incidente | Respuestas ACTIVO y RESUELTO, ID ajeno y campos inválidos: CORREGIDO Y VERIFICADO |
| Un GET tardío borraba comentarios recién enviados | Se fusionan por ID y fecha, conservando los mensajes reconocidos por el servidor | Carga tardía y duplicados: CORREGIDO Y VERIFICADO |
| Una respuesta tardía podía reemplazar el texto de moderación por el mensaje original | El snapshot canónico del servidor y su texto de retirada tienen prioridad sobre un reconocimiento antiguo | Ambos órdenes de llegada: CORREGIDO Y VERIFICADO |
| El agente sólo podía consultar los primeros 250 incidentes | Se usan página, límite, búsqueda y total del servidor; controles Anterior/Siguiente y cancelación de lecturas obsoletas | Conjunto de 251 incidentes y búsqueda del último: CORREGIDO Y VERIFICADO con transporte aislado |
| Los avisos no tenían acceso a su incidente | Se conectó Ver incidente al endpoint existente, con carga, cancelación, cierre al cambiar de cuenta y reintento | Flujo completo de aviso a detalle en navegador: CORREGIDO Y VERIFICADO |
| El mapa retenido conservaba favoritos borrados en Perfil y bloqueaba el cupo | Guardar y borrar notifican a ambas vistas, que recargan con cancelación de la petición anterior | Borrar con mapa oculto, volver y guardar otra ruta: CORREGIDO Y VERIFICADO |
| Ubicar centraba antes de recibir el GPS y requería otra pulsación | Se espera el fix nuevo; un fallo o un mapa destruido no mueve la cámara con datos anteriores | Una pulsación, fallo y respuesta tardía: CORREGIDO Y VERIFICADO |
| Atrás de Android no hacía nada en el mapa ni cerraba primero un diálogo | Orden de atención: diálogo superior, pantalla previa, mapa y minimización de la aplicación | Política real y registro de diálogos probados; confirmación física nativa pendiente |
| Los diálogos dejaban escapar el foco y el detalle no respondía a Escape | Foco inicial, ciclo Tab/Shift+Tab, Escape, semántica de diálogo y devolución del foco al control de apertura | Prueba de interacción y apertura desde avisos: CORREGIDO Y VERIFICADO |
| La lectura tardía del tema revertía una elección reciente; el almacenamiento podía fallar sin manejarse | Intención del usuario tiene prioridad; escrituras ordenadas y fallos de preferencias contenidos | Lecturas y escrituras diferidas, almacenamiento bloqueado y desmontaje: CORREGIDO Y VERIFICADO |
| Se mantenían marcadores gráficos de toda la provincia aunque estuvieran fuera de la vista | Se crean sólo en el viewport con un margen del 25 %; se conservan todos los datos y el mapa de calor | Visibilidad, paneo, actualización y selección de marcadores; heatmap íntegro: CORREGIDO Y VERIFICADO |
| Algunos errores GPS aparecían en inglés | Mensajes claros en español para espera agotada, señal ausente y ubicación desactivada, conservando sus códigos y reintentos | Pruebas de traducción y comportamiento de reintento: CORREGIDO Y VERIFICADO |

Validación de esta segunda auditoría:

- `npm test`: **142 pruebas aprobadas**, sin fallos, cancelaciones ni omisiones en este equipo. Las regresiones de páginas de autenticación usan un Chromium local si está disponible; no deben confundirse con acceso real a proveedores.
- `tests/ui-smoke.mjs`: **20 comprobaciones aprobadas**, sin errores del navegador. Las llamadas externas se bloquean o sustituyen por datos locales.
- `tests/navigation-ui-smoke.mjs`: **5 comprobaciones aprobadas** sobre componentes reales y adaptadores aislados de mapa, GPS y transporte.
- TypeScript y compilación Vite aprobados; sincronización Android aprobada con ocho plugins. Los requisitos Firebase nativos siguen pendientes.
- `npm audit --json`: **0 vulnerabilidades reportadas**, incluidas las dependencias de desarrollo en la consulta de esta revisión. No es una certificación general de seguridad.
- Registros y estado inicial: `.local/audit-2026-10-15-v2/`. Las capturas de interfaz vigentes siguen en `.local/ui-smoke/`.
- Gradle `assembleDebug`: **BUILD SUCCESSFUL en 1 min 21 s**. APK y SHA-256 vigentes en el apartado 8.
- Android nativo: **CORREGIDO SIN PRUEBA COMPLETA**. La APK se instaló y se aceptó su inicio, pero el renderer fue cerrado por memoria en el emulador de 3 GB; también se observó un bloqueo de System UI. La nueva comprobación física de Atrás, GPS y los flujos autenticados continúa pendiente. Evidencia en `native/environment.json`, `native/start.xml`, `native/exit-info.txt` y `native/errors.txt` dentro de la carpeta de esta auditoría. El emulador y su servidor de prueba se cerraron al terminar.

La optimización de marcadores reduce trabajo gráfico medido en las pruebas; no demuestra por sí sola que se haya resuelto el cierre de WebView registrado anteriormente. La verificación nativa y los proveedores reales conservan los límites descritos en este informe. No hubo cambios fuera de `mobile/`, mutaciones en producción, migraciones, despliegues, commits ni push.
