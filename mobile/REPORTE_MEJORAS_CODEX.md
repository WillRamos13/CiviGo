# Mejoras integrales de CiviGo Mobile

Operación del **20 de octubre de 2026**. Inicio registrado de la inspección: **05:10:40, Lima / 10:10:40 UTC** (`baseline.json`). Rama inicial `main`; commit `cfd9326c4224cf4cfe6f378d3b6d9a597227562b`.

El cierre y la duración real se registran al final de este archivo. Se conservaron los 51 cambios locales preexistentes. Las modificaciones de esta operación pertenecen exclusivamente a `mobile/`. No hubo commit, push, despliegue, migración, publicación de APK ni modificación de producción.

## Resultado implementado

### Estabilidad y recuperación

- Viaje activo guardado por cuenta: geometría, destino, transporte, instrucciones y avance. Caduca tras 12 horas sin actualizarse. Se recupera sin crear otra entrada en el historial y se identifica como recorrido guardado.
- Se exige un GPS reciente para retomar indicaciones. No se guardan credenciales ni metadatos del sensor. Las escrituras están serializadas; finalizar, salir de sesión y respuestas tardías no pueden resucitar un recorrido.
- El GPS se libera al pasar al fondo y vuelve a registrarse una vez al regresar. Se descartan respuestas de solicitudes canceladas, posiciones antiguas, timestamps no finitos/futuros y precisiones inválidas. Una denegación de permiso recibida después de suspender también se recuerda y detiene un observador automático nuevo; sólo un reintento manual inicia otra solicitud de consentimiento.
- Esa protección incluye peticiones manuales que finalizan cuando su pantalla ya está suspendida. El consentimiento se conserva sin actualizar una vista cerrada y un intento manual nuevo invalida la respuesta anterior.
- Almacenamiento durable ante fallos transitorios de Preferences: journal de intenciones y borrados, reconciliación posterior, aislamiento de operaciones concurrentes y comprobación tras iniciar otro proceso. Evita que un recorrido borrado reaparezca y que se pierda una revocación de sesión pendiente. Si ambos almacenes fallan o el journal es ilegible se comunica error; no se declara un guardado seguro.
- Un 401 de la sesión vigente invalida el recorrido y su contexto privado, incluso si el mapa está desmontado; un 401 tardío de una sesión anterior no invalida otra nueva. Cerrar sesión borra el recorrido guardado. Una cuenta bloqueada no puede iniciar ni recuperar navegación; la respuesta 403 de cuenta bloqueada mantiene su sesión restringida para informar el bloqueo. No se trata cualquier 403 como caducidad. Las pruebas de autenticación y recorrido ejercitan estas diferencias.
- La voz de indicaciones, la captura Web Speech, los refrescos de rutas, búsquedas y tráfico se suspenden al perder el primer plano. El dictado Android solicitado se delega a la actividad oficial del sistema y espera su resultado o cancelación; cambiar de actividad es parte de ese flujo. No se añadió GPS continuo de fondo ni su permiso.
- MainActivity gestiona la terminación del renderer WebView, elimina la instancia inutilizable y recrea la actividad. Un límite de reintento evita un ciclo de cierres; un segundo fallo rápido muestra recuperación nativa manual. En depuración registra causas históricas de salida y memoria, sin coordenadas ni credenciales.
- Si el renderer termina con la actividad oculta, la recreación se difiere hasta volver al primer plano, siguiendo la [guía oficial Android](https://developer.android.com/develop/ui/views/layout/webapps/handle-termination).
- El mapa intenta restaurar WebGL en su instancia, conserva la cámara y reconstruye de forma acotada si no se recupera. Limpia timers, listeners y marcadores. Hay recuperación visible ante un fallo de renderizado React.

No se puede atribuir el cierre original del Xiaomi a una causa única sin su Logcat. Se corrigieron fallos reales del manejo de estado y recuperación; las pruebas de emulador y teléfono físico se distinguen abajo.

### Navegación

- Proyección GPS sobre la ruta y progreso acumulado. La parte recorrida se dibuja gris y la pendiente azul/cian, conservando la geometría original. Protección frente a saltos imposibles, errores de GPS, retrocesos pequeños, muestras fuera de orden y cruces de la propia ruta.
- Próxima maniobra y distancia al giro en el tablero compacto, junto con tiempo restante, distancia, llegada estimada y fuente del cálculo.
- Velocímetro de datos GPS en km/h, filtrado de mediciones y estado no disponible. No se inventan límites de velocidad.
- Botón flotante para recuperar el seguimiento. Mover el mapa manualmente se respeta; consultar un lugar anterior ya no anula un recentrado posterior.
- Recálculo con evidencia GPS sostenida y enfriamiento. La ruta anterior permanece durante errores, cancelación y desconexión. En auto, actualización de estimación en primer plano como máximo cada tres minutos.
- Fuente/fecha de ETA: tráfico TomTom disponible y reciente, tráfico antiguo o estimación local sin tráfico. Un recorrido recuperado o datos antiguos se advierten también en el compacto. No se modificaron las duraciones mediante factores arbitrarios.
- Parada intermedia calculada mediante tres planes del API existente. Se presenta el recorrido total y la diferencia contra una ruta directa calculada, con confirmación. El destino original se conserva en la recuperación y recálculos. Continuar exige GPS preciso a 20 m de la parada y una acción explícita; el último tramo se vuelve a calcular desde la posición actual.

### Búsqueda, lugares e interfaz

- Buscador dedicado con foco, adaptación a `visualViewport`, carga, resultados vacíos, errores, cancelación, caché breve y consultas sin duplicación. Android físico/teclado de Xiaomi quedan pendientes.
- Dictado opcional mediante la actividad oficial de reconocimiento Android o SpeechRecognition cuando existe en el navegador. No añade permiso propio de micrófono ni captura automática. El botón sólo aparece con capacidad real; cancelación, cuenta distinta, edición y respuestas malformadas/tardías se manejan sin reutilizar texto. La voz hablada en un teléfono con reconocedor queda **IMPLEMENTADA SIN PRUEBA REAL**; los tests usan adaptadores declarados.
- Categorías, historial local por cuenta, lugares guardados, Casa y Trabajo. Cambiar de cuenta borra el contexto visible anterior, incluidas coordenadas y modo del planificador.
- Fichas con nombre, descripción, coordenadas, fuente y distancia geométrica, compartir, guardar, ver ubicación dentro del mapa CiviGo y consultar rutas. Se omiten reseñas, horarios, teléfono y fotos que el contrato no entrega.
- Buscar durante el viaje conserva su destino. El filtro de 500 m se identifica como proximidad geométrica a los resultados disponibles, no como búsqueda exhaustiva ni desvío por carretera.
- Tarjetas compactas de recientes: icono real, tipo, riesgo sólo si existe, ubicación, fecha, descripción, estado disponible y acción de mapa. Se mantiene el máximo de 10 dentro de 1 km.
- Indicador inicial de alertas pequeño, actualización de fondo sin bloque grande y conservación de los datos anteriores ante fallos. Los avisos de desconexión, alertas, mapa, riesgo, GPS e historial usan títulos contraídos; el detalle, la fecha disponible y los reintentos se abren voluntariamente. La desconexión y el fallo del API no generan dos tarjetas repetidas.
- Modo oscuro propio en azul marino/petróleo/grafito. Se conserva el estilo claro original y se añade Claro/Oscuro/Automático. Se actualiza la pintura sin recrear fuentes, ruta ni marcadores.
- Barra de estado Android adaptada al tema: texto oscuro en claro y claro en oscuro. Se sincronizan los atributos del tema nativo que restaura el splash, la ventana y el estado interno de StatusBar; se reaplica por primer plano/foco. No cambia el modo nocturno global, no recrea actividades y no usa temporizadores. El primer intento sólo JavaScript y el posterior temporizador fallaron en arranque frío y se retiraron; no se declararon aprobados.
- Flecha y galería de compacto, sedán, SUV y deportivo con colores, guardados por usuario. El icono elegido no cambia el modo de transporte.
- Corregido un bucle de imagen: un recurso y su fallback fallidos ya no causan miles de solicitudes; máximo dos intentos y luego un SVG local sin red.

### Spotify

Se incorporó el SDK oficial App Remote **0.8.0**, su licencia, procedencia y huella. El puente nativo compila y ofrece autorización explícita, estado real, portada acotada, pausa/reproducción, anterior/siguiente, restricciones del proveedor, timeouts y desconexión.

Permanece apagado por defecto. Desactivado no monta el controlador ni conecta. Activarlo no autoriza: hace falta pulsar Conectar. La UI cambia únicamente con eventos del SDK, conserva una instancia al plegar/desplegar y elimina datos al cambiar cuenta. No se guardan tokens ni Client Secret.

**Conexión real BLOQUEADA por configuración externa:** registrar la aplicación Android en Spotify, su Client ID público, paquete `com.civigo.app`, SHA1 de firma y URI de retorno exacto. Compilar con `CIVIGO_SPOTIFY_CLIENT_ID` y, si cambia el predeterminado `civigo://spotify-callback`, `CIVIGO_SPOTIFY_REDIRECT_URI`. Estas variables corresponden a la compilación Android, no a Railway/Vercel. El usuario necesita Spotify instalado y autorizar la conexión. No se modificó ninguna cuenta externa.

Antes de habilitarlo para más usuarios debe verificarse la elegibilidad del proyecto y sus usuarios autorizados en Spotify. Las condiciones del Client ID y del [modo de desarrollo](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) no se consideran evitadas por usar App Remote. No se añadieron Web API, reproducción fingida ni una clave secreta al APK.

## Estado por requisito

| Requisito | Estado y alcance |
|---|---|
| AND-001, cierre observado en Xiaomi | Recuperación de proceso/renderer y suspensión **CORREGIDAS Y PROBADAS** en emulador. Xiaomi/WhatsApp: **IMPLEMENTADO SIN PRUEBA REAL**. Estabilidad global **BLOQUEADA** por cierre del WebView reproducido también fuera de CiviGo en este entorno; no se atribuye la causa del teléfono sin sus registros. |
| NAV-001, presentación del ETA | **CORREGIDO Y PROBADO** en lógica/contrato/UI. Calibración del algoritmo y fidelidad real de tráfico: **BLOQUEADO** por alcance backend y prueba de recorrido físico. |
| NAV-002, línea recorrida | **CORREGIDO Y PROBADO** con geometrías y GPS de pruebas; pendiente validar en recorrido físico. |
| NAV-003, lugares/paradas | **CORREGIDO Y PROBADO** en contratos y flujo completo con transporte aislado. Itinerario optimizado conjunto y búsqueda exhaustiva por corredor: **PENDIENTE** backend. |
| NAV-004/005/006 | **CORREGIDO Y PROBADO** en UI/lógica: recentrado, maniobra compacta y velocidad. GPS/velocidad físicos: **IMPLEMENTADO SIN PRUEBA REAL**. |
| NAV-007, recálculo | **CORREGIDO Y PROBADO** con GPS preciso/impreciso, desconexión, cancelación y retorno. Validación vial real **PENDIENTE**. |
| RISK-001, segmentación | **BLOQUEADO** para corregir el algoritmo: backend no autorizado. Mobile conserva fielmente segmentos/versiones; propuesta completa preparada. |
| MAP-001, nombres de calles | **PENDIENTE** verificación de nombre oficial y actualización del proveedor/OSM. No se inventaron sustituciones. |
| MAP-002 | **CORREGIDO Y PROBADO** indicador y conservación de snapshot. |
| MAP-003 | **CORREGIDO Y PROBADO** en Mapbox/UI local; se restaura la pintura clara original. Comprobación nocturna física **PENDIENTE**. |
| UX-001/002/003/004 | **CORREGIDO Y PROBADO** avatares, panel compacto, tarjetas y flujo. |
| SEARCH-001/PLACE-001 | **CORREGIDO Y PROBADO** con los campos existentes. Dictado **IMPLEMENTADO SIN PRUEBA REAL** hablada en teléfono; controladores/UI probados y disponibilidad condicionada al sistema. Campos ampliados del proveedor **PENDIENTES**, no simulados. |
| INT-002 | Bridge **IMPLEMENTADO SIN PRUEBA REAL** de Spotify; conexión **BLOQUEADA** por Client ID/autorización externos. SDK y contratos compilados/probados. |
| INT-001 | **PENDIENTE/BLOQUEADO** HyperIsland: no Xiaomi conectado ni contrato de compatibilidad validado; no hay isla falsa ni compatibilidad declarada. |

## Pruebas y compilación

- Línea base: **200/200** pruebas.
- Suite ampliada final: **294/294**, sin fallos, canceladas u omitidas; incluye privacidad, persistencia, GPS, progreso, velocidad, ETA, recálculo, paradas, Spotify y dictado. Las pruebas del ejecutor verifican que los fallos reales no se ocultan. Las 16 regresiones nuevas de almacenamiento incluyen procesos JS nuevos, logout, recorrido, cuotas, fallos de ambos almacenes y operaciones concurrentes. Las 9 pruebas de voz cubren cancelación, pausa, cambio de cuenta, falta de API y respuestas malformadas; cuatro del tema nativo incluyen el hook React y orden/cancelación de llamadas.
- QA integral con React/AppContent/CSS reales: **10 combinaciones de pantalla/tema y 51 comprobaciones**. GPU, transporte, GPS, voz y Spotify son adaptadores/fixtures explícitos en este smoke, no servicios reales.
- Vite + Mapbox local: **23 escenarios**. Navegación: **6 comprobaciones**. Ciclo del mapa: **5 ciclos y 12 comprobaciones**. Buscador: **9 comprobaciones**.
- Avisos de mapa sin conexión: **9 comprobaciones** con React, MapPage/MapView y CSS reales a 360×640, temas claro/oscuro, panel compacto/expandido, apertura por teclado y `elementFromPoint` para verificar cabeceras/reintentos alcanzables. Mapa, GPS y red de ese guion usan adaptadores explícitos; no hay escrituras a producción. El primer pase visual recortaba el rail y se conservó como rechazado; se corrigió antes de aprobar. Los títulos largos se eliden cuando están contraídos y se leen al desplegar. Reproducible con `node tests/offline-map-notices.mjs`; evidencia en `.local/oct20/offline-map-notices/resultado.json`.
- TypeScript: **sin errores**. Vite: **compilación aprobada**. Conserva un aviso por tamaño del chunk Mapbox; no se suprimió.
- Gradle `assembleDebug` y `lintDebug`: **aprobados, cero errores Lint**. Se detectó y corrigió la guardia API 26 de recuperación WebView para mantener minSdk 23. El compilador Java conserva un aviso de API obsoleta en el plugin de barras del sistema; no se ocultó ni se presentó como error de compilación.
- APK local de depuración **1.1.0 / versionCode 3**, paquete `com.civigo.app`, minSdk 23/target 35; **29.270.666 bytes**. Firma V1/V2 válida y coincidente con el certificado Google Android configurado. Verificados por hash los 28 archivos web dentro del APK y seis definiciones nativas requeridas: voz de navegación, bridge/SDK Spotify, dictado, SystemChrome y Capacitor. SHA-256 final: `48D064988C25E849487EA4ADD7280EE431C4BC3945CC49ED5955A697BD77905B`. Ubicación local: `android/app/build/outputs/apk/debug/app-debug.apk`. No se publicó.
- `npm audit --omit=dev`: **cero vulnerabilidades conocidas** en el registro consultado. No abarca vulnerabilidades desconocidas ni garantiza ausencia de errores.
- Defender sobre APK: **sin amenazas detectadas**. Sin publicación ni distribución externa.

Evidencias: `.local/oct20/`, `.local/liquid-glass-ui-smoke/`, `.local/ui-smoke/`, `.local/oct20-map-lifecycle/` y `.local/places-ui-smoke/`. Los informes de cada prueba identifican sus adaptadores y limitaciones.

## Archivos y dependencias

Cambios principales: `src/services/activeTrip.ts`, `appLifecycle.ts`, `navigationProgress.ts`, `navigationSpeed.ts`, `navigationStops.ts`, `navigationPresentation.ts`, `navigation.ts`, `auth.ts`, `resilientStorage.ts`, `geolocation-consent.ts`, `native.ts`, `nativeChrome.ts`, `speechSearch.ts`, `mapRecovery.ts`, `mapTheme.ts`, `theme.ts`, `navigationAvatar.ts`, servicios de lugares y Spotify; hooks GPS/actividad/tema; MapPage/MapView/RoutePlanner; buscador/fichas/tarjetas/avatares/reproductor/ErrorBoundary; CSS y pruebas.

Android: `MainActivity.java`, `SpotifyRemotePlugin.java`, `SpeechSearchPlugin.java`, `SystemChromePlugin.java`, estilos de barras, Manifest y Gradle de `mobile/android/app/`, AAR en `libs/`, licencia/procedencia en `third_party/spotify/` y recursos web generados. No se cambiaron configuraciones de raíz, el SDK Android instalado, proveedores, backend, frontend ni desktop.

Inventario de la operación: [archivos editados o regenerados](.local/oct20/archivos-editados.txt), 105 archivos, incluidos 46 de `src/` y 22 de pruebas. Incluye recursos generados por Vite/Capacitor; no atribuye a esta operación los cambios locales anteriores. La comprobación de hashes de archivos fuera de Mobile está en `.local/oct20/scope-check.json`.

## Lo que requiere otra intervención

1. Xiaomi físico: repetir CiviGo → WhatsApp → CiviGo, bloqueo/desbloqueo y recorrido real; recoger Logcat, memoria y causas de salida. Ningún emulador acredita compatibilidad específica con HyperOS/HyperIsland.
2. Backend: calibración de velocidades/demoras, validación de correspondencia TomTom, fallback por candidato, subsegmentos de riesgo sin perder conectividad, corredor de lugares y planificación conjunta con paradas. Ver `PROPUESTAS_BACKEND_PENDIENTES.md`.
3. Spotify: Client ID, registro de firma/paquete/retorno y autorización de usuarios; prueba física con la aplicación oficial.
4. Cartografía: identificar las calles concretas y verificar su nombre contra una fuente autorizada antes de corregir OSM/proveedor.
5. Dictado: probar voz hablada con un reconocedor real y su autorización en el teléfono. Notificación de progreso/HyperIsland: integración oficial y validación del dispositivo pendientes. No se añadió reconocimiento fingido ni GPS continuo sin consentimiento.

Fuentes primarias: [recuperación WebView](https://developer.android.com/develop/ui/views/layout/webapps/handle-termination), [Capacitor App](https://capacitorjs.com/docs/apis/app), [Mapbox Map](https://docs.mapbox.com/mapbox-gl-js/api/map/), [Spotify App Remote](https://developer.spotify.com/documentation/android/tutorials/getting-started), [ciclo de vida Spotify](https://developer.spotify.com/documentation/android/tutorials/application-lifecycle), [notificaciones oficiales de progreso](https://developer.android.com/develop/ui/compose/notifications/progress-centric).

## Prueba Android, memoria y cierre de la operación

Entorno: emulador `Small_Phone`, Android 17/API 37, x86_64, páginas de 16 KB, WebView 145.0.7632.218. CiviGo compila y apunta a SDK 35, minSdk 23; el target 36 observado en algunos registros pertenece al **proveedor WebView**, no a CiviGo.

La sesión se ejecutó sobre una copia AVD temporal de sólo lectura. Una instalación anterior tenía otra firma; se hizo instalación limpia sólo en esa copia. Ningún teléfono físico, cuenta real ni base de producción se utilizó para los fixtures.

**Recuperación comprobada:** recorrido, destino, modo y guía tras muerte del proceso; primer renderer provocado recuperado; segundo fallo rápido muestra recuperación nativa manual; retorno desde Settings después de 10/60/180 s. A 180 s hubo recuperación después de un cierre, por lo que ese caso no prueba ausencia de fallos. WhatsApp no está instalado; Settings verifica una transición real entre tareas, no su equivalencia específica con WhatsApp.

**Cierre nativo abierto y aislado:**

- Con 2 GB hubo salidas `LOW_MEMORY`, también de apps del sistema. Se conservaron sus registros y se continuó con 3 GB; no se atribuyó por ello el problema del Xiaomi a falta de RAM.
- Con 3 GB apareció `APP CRASH(NATIVE)`, `SIGILL`, en `libwebviewchromium.so+0x72e31d9`, llamado desde `WV.rg1.onTrimMemory`. Se reprodujo con navegación limpia, sin fallo de renderer previo. Seis pruebas explícitas de avisos MODERATE/COMPLETE no lo reprodujeron; no se ocultó esa diferencia.
- El control mínimo **`com.civigo.qa.webviewprobe`**, sólo WebView/HTML local, **sin CiviGo, Capacitor, Mapbox, GPS, JavaScript, permisos, red ni CDP**, reprodujo el mismo SIGILL, PC y BuildId del proveedor. Este resultado demuestra reproducción fuera del producto en el entorno actual; no identifica por sí solo el defecto interno exacto ni certifica el comportamiento de un Xiaomi físico.
- No se aplicó un parche que suprima los avisos de memoria del sistema, ni se actualizó/configuró el proveedor fuera del alcance autorizado. La corrección o actualización de ese entorno y la comparación con el teléfono quedan **BLOQUEADAS/PENDIENTES**. La recuperación de recorrido sí funciona, pero no se declara estabilidad absoluta.

Control y pruebas: `.local/oct20/native-lifecycle/provider-isolation-result.json`, `webview-probe-no-cdp-result.json`, `e890-full-result.json`, `0c5a-clean-control-result.json`, backtraces legibles y capturas reales. El control mínimo se recompila con `.local/oct20/webview-probe/build.ps1`; su APK de diagnóstico no forma parte de CiviGo ni se publicó.

Memoria observada del **proceso principal** con 3 GB y APK E890: invitado 132.581 KB PSS, recorrido restaurado 138.916 KB, tras 60 s de fondo/retorno 141.340 KB. Son mediciones puntuales con mapa offline y fixture explícito; no incluyen toda la memoria de los renderers separados ni demuestran ausencia de fugas.

**Mapa público, APK B030:** cinco minutos en primer plano sin cierre ni excepciones JavaScript observadas, sin iniciar sesión ni escrituras a producción. La interfaz mostraba 551 registros; no se auditó su autenticidad. Canvas de 720×952. PSS principal: 173.765 KB a los 60 s y 177.781 KB a los 300 s; RSS: 325.120→328.908 KB. Son muestras del proceso principal, no el total de los renderers ni una demostración de ausencia de fugas. El guion no pudo acreditar HTTP 200 de Mapbox/TomTom desde CDP de la página y falló esa aserción: no se declara cobertura completa de teselas ni tráfico remoto validado. Evidencia: `native-lifecycle/public-map-observation.json`.

**APK final 48D064:** arranque claro antes de tocar controles, oscuro persistido tras terminar/reabrir el proceso, vuelta a claro y selección de Automático comprobados en capturas y estado LIGHT/DARK. Tres avisos offline cerrados de 28 px CSS. SpeechSearch informó disponibilidad sin abrir el micrófono; Spotify siguió sin configurar. Evidencia: `native-lifecycle/48d064-final-native-result.json` y capturas con ese prefijo.

**Retorno visual suplementario:** el guion anterior consultaba las barras y capturaba pronto; su resultado 4/4 no bastaba porque `48d064-19-tema-final-retorno-settings.png` estaba blanca. Se preservó y se reforzó la comprobación con actividad superior, App activa, DOM y superficie PNG real. El primer intento suplementario terminó por `LOW_MEMORY` durante el arranque de la copia de 3 GB, antes de llegar al retorno; también se cerraron aplicaciones del sistema. Quedó registrado y no se contó como aprobado. Tras estabilizar el arranque, un único reintento completó Settings 10 s: mismo PID, MainActivity superior, 25 botones y mapa 360×476, superficie CiviGo visible en capturas observadas a **1,905 y 3,490 s** después de volver. Sin excepciones JS ni cierre en ese pase. No acredita la captura anterior a unos 650 ms ni descarta latencia transitoria; tampoco reemplaza el recorrido físico o el ensayo prolongado del proveedor. Evidencias: `native-lifecycle/settings-return/result.json`, `22-suplemento-retorno-1000ms.png`, `22-suplemento-retorno-3000ms.png` y `first-attempt-low-memory-*`.

Incidencias del entorno registradas: disco C agotado durante una reconstrucción, resuelto retirando únicamente una instantánea RAM regenerable de un emulador de pruebas antiguo; fallo de arranque de la copia temporal durante ese agotamiento, resuelto regenerando esa copia; selector del guion nativo que no aceptaba las mayúsculas del botón, corregido contrastándolo con captura/UIAutomator. Ninguno se presentó como una corrección de CiviGo o se ocultó para obtener resultados verdes.

## Cierre registrado

Fin: **2026-10-20 12:50:43 UTC / 07:50:43, Lima**. Duración desde la inspección registrada: **2 h 40 min 3 s**.

Comprobación final: 445 archivos versionados fuera de Mobile sin cambios de hash; estado externo preexistente preservado; README vacío. Inventario: 105 archivos editados o regenerados, 46 de src y 22 de pruebas. Suite final 294/294, TypeScript/Vite/Capacitor/Gradle/Lint aprobados; APK local final firmado y verificado. Sin publicación, commit, push, despliegue, migración ni escritura de producción.

Continúan pendientes el Xiaomi físico y WhatsApp, el cierre prolongado del proveedor WebView, la validación vial del ETA/GPS, la configuración/autorización Spotify, los cambios backend documentados y la compatibilidad real HyperIsland.
