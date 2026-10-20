# Trabajo de mejoras CiviGo Mobile — 20 de octubre de 2026

Inicio registrado de la inspección: 2026-10-20 10:10:40 UTC (05:10:40, Lima), según `baseline.json`. Rama `main`, commit inicial `cfd9326c4224cf4cfe6f378d3b6d9a597227562b`.

## Alcance y estado inicial

- Sólo se autorizan cambios en `mobile/`. Sin commits, despliegues, producción ni proveedores externos.
- Se conservaron 51 cambios locales preexistentes, incluido `.github/workflows/checks.yml`.
- Huellas SHA-256 de 445 archivos versionados fuera de Mobile guardadas en `.local/oct20/baseline.json` para comprobar el alcance al finalizar.
- Se iniciaron las pruebas del estado inicial. La APK del 18 de octubre no demuestra los cambios de esta operación.
- ADB no pudo iniciar su daemon dentro del sandbox en la primera comprobación. Se volverá a intentar con acceso local autorizado. No hay evidencia todavía de un Xiaomi conectado.

## Fase 1 — Diagnóstico confirmado

- `MapPage` conserva un viaje mientras sigue montado, pero no tiene recuperación persistente tras terminar el proceso.
- `useGeolocation` no observa el estado foreground/background de Android.
- El cliente WebView instalado de Capacitor devuelve `false` si nadie gestiona la terminación del renderer. MainActivity no registraba un manejador de recuperación.
- MapView no gestionaba explícitamente la pérdida/restauración del contexto WebGL.

## Verificación

Las pruebas de código, navegador, emulador y teléfono real se registrarán por separado. No se declarará corregido el cierre observado en Xiaomi sin reproducir sus transiciones reales.

## Avance — 10:29 UTC

- Línea base: 200 pruebas aprobadas, sin fallos ni omitidas.
- Recuperación de recorrido implementada por cuenta: destino, transporte, geometría y avance; expiración de 12 horas, cola de escrituras y eliminación al finalizar/cerrar sesión. No se guardan credenciales ni metadatos de sensores.
- GPS en primer plano: limpieza al suspender, registro único al volver, invalidación de solicitudes tardías y rechazo de timestamps no finitos, futuros o antiguos.
- Once pruebas adicionales de persistencia/ciclo de vida/GPS aprobadas, incluida integración del hook React con cambios de visibilidad repetidos.
- Emulador Android 17 arrancado con 2 GB de RAM. No hay teléfono físico conectado.
- Primera compilación Java nativa aprobada. Lint detectó una llamada de API 26 sin guardia para minSdk 23 en recuperación WebView; se añadió la comprobación explícita de versión y se repetirá lint.
- MapView: recuperación de contexto, tema sin recreación, dibujo de ruta pendiente/completada y recentrado flotante; pruebas unitarias e integración con adaptador GPU aprobadas.
- Búsqueda/fichas/tarjetas implementadas con datos reales del contrato; pruebas de componentes en navegador aprobadas. Paradas por tramos reales e integración Spotify oficial en curso.

## Avance — 10:56 UTC

- Suite completa ampliada: 259/259 aprobadas. QA integral: 10 tamaños/temas y 51 comprobaciones; Vite/Mapbox local 23 escenarios; navegación 6; mapa 5 ciclos/12 comprobaciones; lugares 9.
- APK 1.1.0/versionCode 3 compilada, firma validada, 28 assets web coincidentes, SDK Spotify/voz presentes, Lint 0 errores. Defender sin detecciones y audit npm de producción con 0 vulnerabilidades conocidas.
- Los registros reales del AVD con 2 GB confirmaron `LOW_MEMORY` (reason=3), cierres de CiviGo y de varias aplicaciones del sistema, swap agotado y advertencias de memoria de teselas. No se confundió con una excepción Java de CiviGo ni con la causa del Xiaomi.
- Se reinició sólo la copia temporal de sólo lectura del AVD con 3 GB; memoria disponible inicial aproximada de 2 GB. Los datos del AVD original y del teléfono no se modificaron.
- La versión antigua del AVD tenía otra firma y requería instalación limpia en esa copia temporal. La APK de esta operación conserva la firma configurada en Google Android.
- Revisión adicional de permiso GPS tardío en curso: una negativa recibida después de suspender no debe volver a solicitarse automáticamente. Se revisa el contrato nativo real antes de cambiar código; el SDK instalado ya contiene una blacklist para `clearWatch` anterior al primer resultado, por lo que no se atribuye una fuga no demostrada.

## Avance — 11:07 UTC

- Corregida la negativa GPS tardía con revisión por intento manual, cancelación de observación automática e invalidación de respuestas de intentos anteriores. Los adaptadores reales web/nativo se ejercitan con el puente inyectado; 19 pruebas enfocadas aprobadas y suite completa final 264/264.
- Se verificó el contrato instalado de Capacitor Geolocation 7.1.8 / iongeolocation-android 1.0.0: la cancelación previa al primer resultado ya dispone de blacklist. No se modificó el SDK ni se añadió un reintento ficticio para una fuga no demostrada.
- La última reconstrucción se interrumpió por disco C sin espacio. Se liberaron 4 GB eliminando únicamente `mobile/.local/emulator/avd/CiviGoCodexSmoke20261015.avd/snapshots/default_boot/ram.img`, instantánea RAM regenerable de una prueba anterior. Se verificó previamente que ese emulador no estuviera ejecutándose; no se borró su disco de datos ni el AVD Small_Phone original.
- Reconstrucción posterior: TypeScript/Vite/Capacitor/assembleDebug/lintDebug aprobados. Nueva APK con corrección GPS, 28 assets coincidentes, firma válida, Lint 0 errores y Defender sin amenazas detectadas. SHA-256 E8901D16FDA5FC0CA4332DFF38753E99C7FAC4C67B258421486BCE8FE412D9D3.
- El AVD de 3 GB presentó un fallo del sistema Android en `DevicePolicyManagerService`, con `roles.xml` incompleto, durante el agotamiento del disco del host y antes de instalar la APK final. Se conserva esa evidencia; se regenera sólo la copia temporal de sólo lectura para continuar, sin atribuir este fallo a CiviGo.

## Avance — 11:21 UTC

- Revisión adversarial encontró otro caso GPS: la negativa de una petición manual que terminaba después de suspender quedaba descartada. Corregida mediante revisión de consentimiento independiente de la petición visual; un reintento manual posterior invalida la negativa antigua. Pruebas Chromium del hook real aprobadas.
- Corregido almacenamiento alternativo: un fallo temporal de Preferences podía dejar un borrado sin efecto o perder la marca durable de logout al recrear el proceso. Se incorpora journal de intenciones/tombstones, reconciliación, orden entre operaciones y error cerrado si no es posible confirmar almacenamiento. Regresiones con procesos nuevos, logout, recorrido, quotas y operaciones concurrentes aprobadas.
- Prueba Android E890: recuperación tras muerte del proceso, dos fallos deliberados del renderer, recuperación manual y transiciones a Settings de 10/60/180 segundos. A 180 segundos se recuperó el recorrido, pero el proceso principal había sufrido un cierre nativo inesperado; no se considera estabilidad completa aprobada.
- Cierre inesperado: `SIGILL`, WebView 145.0.7632.218, `WV.rg1.onTrimMemory`, `APP CRASH(NATIVE)` en Android 17 x86_64 de 16 KB. Se compara proceso limpio con proceso recuperado tras `Page.crash` para aislar la causa, sin atribuirlo a memoria insuficiente ni al Xiaomi.
- La guía oficial de Android requiere diferir la recreación del WebView mientras la actividad está oculta. MainActivity ahora guarda la recuperación pendiente hasta `onResume`; no se considera por sí sola una corrección del SIGILL pendiente de diagnóstico.
- Contraste de barra de estado corregido según tema y actualizaciones nativas serializadas. Se reconstruye otra vez la APK por estas correcciones finales y se repetirá su smoke nativo.

## Avance — 11:27 UTC

- El primer pase completo tras sustituir StorageService detectó una incompatibilidad del entorno Node/SSR sin `window`: PreferencesWeb no podía leerlo. Se corrigió con un driver de memoria únicamente en SSR/no nativo; Android y navegador conservan almacenamiento durable y política cerrada. Se preservó el log fallido; no se omitieron pruebas.
- Suite completa final: **281/281**, 0 fallos/canceladas/omitidas. Revalidación de almacenamiento/auth/cámara/tema: 69/69; Vite/Mapbox local: 23/23, sin errores JS. El primer timeout al abrir Vite no se atribuyó sin evidencia a la app; el reintento con las mismas fuentes pasó.
- APK final sincronizada con las últimas fuentes: `0C5AD0876D2A44E7B421605C8A23DBE6FF00ED828ECA2E97EFE961C704A6EBC0`, firma válida, certificado Google coincidente, 28 assets idénticos, ambos plugins nativos y SDK oficial presentes, Lint 0 errores, Defender sin detecciones.
- Seis experimentos controlados con la APK E890 (0/1/2 fallos provocados de renderer × avisos de memoria MODERATE/COMPLETE) no reprodujeron el SIGILL del proceso principal. El evento original no se borra ni se declara resuelto; diagnóstico pendiente. Se inicia la última comprobación con APK final: fondo limpio 180 s, bloqueo, recuperación diferida y mapa público sin sesión.

## Diagnóstico abierto — 11:30 UTC

- La APK final reprodujo el mismo cierre nativo en el control limpio de 180 s, sin ningún `Page.crash` anterior: proceso principal, `SIGILL`, `libwebviewchromium.so+0x72e31d9`, `WV.rg1.onTrimMemory`. Por tanto no basta atribuirlo a las pruebas forzadas de renderer ni declarar aprobada la estabilidad.
- Se detuvo la fase pública de ese guion tal como estaba previsto, se retiró el fixture y se restauró la red únicamente después de detener la app.
- Se prepara un control Android mínimo con WebView/HTML local, sin Capacitor, Mapbox, GPS, plugins, permisos ni tráfico de red, dentro de `.local/oct20/webview-probe/`. Comparará el proveedor con CiviGo en el mismo emulador sin modificar configuraciones de proveedores.
- Se completa también SEARCH-001 voz con integración oficial condicionada a disponibilidad real. La investigación evita credenciales nuevas y captura propia de micrófono; no se anunciará disponible sin comprobar el contrato y las capacidades.

## Aislamiento y cierre funcional — 12:07 UTC

- El WebView mínimo reprodujo exactamente el SIGILL, PC y BuildId del proveedor en fondo, sin código de CiviGo ni sus dependencias. Se conserva `provider-isolation-result.json`; no se construyeron controles adicionales innecesarios ni se modificó el proveedor. Se mantiene pendiente la causa interna exacta y el diagnóstico del teléfono físico.
- La APK B030 pasó recuperación, Settings 10 s, bloqueo/desbloqueo y renderer provocado mientras la actividad estaba oculta: no se reconstruyó WebView en el fondo; al volver se recuperó el recorrido. SpeechSearch informó `available:true` sin abrir el micrófono. Spotify siguió sin configurar y desactivado.
- Mapa público en primer plano durante cinco minutos: 551 registros visibles, canvas 720×952, cero cookies y sin cierre/excepciones JS. PSS principal aproximado 174→178 MB. No se obtuvo confirmación HTTP 200 de Mapbox en CDP de la página; se preservó el fallo de esa aserción del guion y se registró por separado lo realmente observado, sin inventar validación de teselas.
- La corrección inicial de barra de estado funcionaba al alternar tema pero falló en arranque frío. El intento de resincronización temporizada también falló en APK 762A y se retiró, sin declararlo aprobado.
- Código instalado AndroidX core-splashscreen 1.0.1: el callback de salida aplica las barras desde `activity.theme`, mientras que el estilo JavaScript sólo actualizaba la ventana. Se implementó `SystemChromePlugin` con dos estilos limitados a esos atributos, sincronización del estado interno de StatusBar y reaplicación por foco/primer plano. No cambia el modo nocturno global ni recrea actividades, no tiene temporizadores.
- Dictado final: reconocimiento oficial, sin permiso propio de audio, respuestas vacías/malformadas/tardías controladas. Nueve pruebas de voz y cuatro nuevas del tema nativo; suite completa final **294/294**, sin fallos, canceladas u omitidas.
- Se reconstruye la APK con SystemChrome y se verificará en frío antes de cerrar. Lint y Defender de APK anteriores no se presentarán como evidencia del archivo final.

## Comprobación nativa final — 12:12 UTC

- APK `768187316BDFD4A9D550B0DC7E9AF12F24AA389393EB942F24EC740743E9D24D`: pase de 40,8 s aprobado. Claro antes de pulsar controles, oscuro persistido tras force-stop/reapertura, vuelta a claro, Automático y retorno desde Settings a los 10 s. Capturas y estado del plugin confirmaron el contraste. Sin excepciones ni cierre durante este pase breve.
- Se mantuvo la distinción entre voz disponible y dictado hablado: no se abrió el micrófono. Spotify continuó sin configuración ni conexión. No se usaron cuentas reales ni escrituras de producción.
- Se apagó únicamente la instancia AVD de sólo lectura; red y GPS restaurados. Una expresión PowerShell de limpieza devolvió líneas XML en vez de un booleano: se conservó el original y se documentó esa comprobación directa como no acreditada. La revisión automática rechazó forzar ese campo a verdadero y esa escritura no se ejecutó. La corrección separada conserva la incertidumbre; `pm clear`, modo sin fixture y cierre tienen evidencias independientes.
- Inspección visual adicional encontró avisos de desconexión/API/mapa demasiado grandes y apilados. Se prepara una corrección mínima de MAP-002: títulos contraídos con detalle y reintentos accesibles; no se ocultarán errores ni se cambiarán datos. Se repetirán pruebas de UI y compilación por este cambio.

## Última regresión visual — 12:35 UTC

- MAP-002: componente compartido de avisos contraídos, sin duplicado de API/desconexión; detalle, fecha y botones originales conservados. Columna junto a Capas/controles; al abrir un aviso se cierra el anterior y se mantiene cabecera accesible. No cambia los datos ni el recorrido.
- El primer guion pasaba funcionalmente pero la inspección visual encontró recorte con el panel abierto. Se conserva `offline-map-notices/first-pass/qa-observation.json` como rechazo de QA. La distribución final pasó 9 comprobaciones en ambos temas, con teclado y pulsación real verificada por `elementFromPoint`; capturas revisadas. Los títulos largos se eliden sólo contraídos, sin afirmar que todo su texto cabe en una línea.
- Se adaptaron únicamente las aserciones de GPS/historial al despliegue explícito. Un fixture de MapView que devolvía null no exponía el nuevo slot de avisos; se corrigió el fixture y el caso historial comprueba contraído → abrir → detalle. Navegación focal: 4/4.
- TypeScript sin errores; nueva compilación y suite completa en curso con fuentes congeladas. La APK 768187 anterior quedó verificada y conservada como evidencia separada: firma/OAuth coincidente, 28 assets, seis definiciones nativas requeridas, Lint 0 y Defender sin detecciones.

## APK final y contraste de la evidencia — 12:41 UTC

- Fuentes finales: suite **294/294**, sin fallos/omitidas; TypeScript/Vite/Capacitor/assembleDebug/lintDebug aprobados. APK `48D064988C25E849487EA4ADD7280EE431C4BC3945CC49ED5955A697BD77905B`, 29.270.666 bytes. Firma/OAuth, 28 assets, seis definiciones nativas requeridas y Defender comprobados sobre ese archivo. Lint conserva fecha válida para el último cambio Java; no se falsificó una fecha ni se repitió innecesariamente.
- Pase nativo de 46,7 s: arranque claro y oscuro persistido correctos en capturas; tres avisos contraídos de 28 px CSS. El guion marcó 4/4, pero la revisión visual del root encontró que `48d064-19-tema-final-retorno-settings.png` estaba blanca. El estado LIGHT sólo acreditaba el estilo de barras, no que CiviGo estuviera presentado. Se conserva el JSON y la captura; ese retorno no se declara visualmente aprobado con ese pase.
- Se ejecutará un control suplementario corto: actividad activa, DOM y capturas tras 1 y 3 s de volver de Settings. Distinguirá captura prematura de pantalla blanca persistente. Sin tocar el producto ni repetir los ensayos largos del proveedor.

## Resultado suplementario — 12:49 UTC

- El primer intento no llegó al retorno: con 3 GB, al arrancar la copia hubo cierres LOW_MEMORY de CiviGo, renderer y aplicaciones del sistema. Se conservan `settings-return/first-attempt-low-memory-*`; no se contaron como aprobación ni se atribuyeron al Xiaomi.
- Tras estabilizar el arranque (MemAvailable aproximado 1,74 GB), el único reintento pasó: mismo PID antes/después de Settings 10 s; MainActivity superior y App activa; DOM visible con 25 botones/mapa 360×476. Capturas observadas a 1,905 y 3,490 s muestran CiviGo completo, con 112 colores cuantizados y 10,0 % cromático. Root inspeccionó la imagen; no está blanca. Se preserva la captura blanca anterior y no se acredita su presentación a unos 650 ms ni se descarta una demora transitoria.
- El helper local exige ahora actividad/DOM/superficie real para futuras capturas; no se cambió el producto. El SIGILL prolongado del proveedor sigue abierto y separado.
- Instancia de sólo lectura PID2480 detenida; red y GPS restaurados, aplicación sin PID e inventario ADB vacío. El XML de Preferences no existía en este control sin tema/fixture escrito: lectura exit1 y ausencia directa sin acreditar (null), conservadas sin forzar verdadero. El control 48D064 anterior sí tenía lectura completa y comprobación directa válida; no se confunden ambos.
- APK y fuentes finales intactas. Hashes de los 445 archivos fuera de Mobile idénticos a la línea base; mismo estado Git externo preexistente, rama/commit sin cambios y README de cero bytes. No hubo commit, push, despliegue ni publicación.

Cierre técnico: 2026-10-20 12:50:43 UTC (07:50:43, Lima); duración registrada 2 h 40 min 3 s. Informe final actualizado y evidencias archivadas.
