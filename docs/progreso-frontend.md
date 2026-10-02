# CiviGo — Estado del frontend ciudadano

Actualizado el 1 de octubre de 2026. Este archivo describe código y verificaciones locales; no representa un despliegue.

## Implementado

- Interfaz responsive en español, centrada en Ica, con navegación compartida y estados de carga/error/vacío.
- Registro completo, inicio/cierre de sesión con cookies HttpOnly del backend y acceso diferenciado a mapa/rutas/participación.
- Verificación de teléfono por SMS/WhatsApp y correo. Los códigos de demostración solo se muestran cuando el backend los habilita explícitamente; no se simulan envíos reales.
- Formulario con siete categorías, catálogo dinámico, distrito, fecha pasada según el tipo, GPS y corrección máxima de 50 metros, confirmación de ubicación y hasta tres adjuntos directos.
- Reportes personales, pruebas privadas, solicitud de revisión y seguimiento del incidente/chat.
- Mapa Mapbox con centro en Ica, marcadores actualizados sin duplicados, líneas de riesgo por tramo real y colores 0–5 acordados. Fuentes, marcadores, intervalos y mapas se liberan correctamente.
- Detalle de incidentes: gravedad separada del riesgo del tramo, confirmaciones y resolución con GPS, alertas por falsedad/no encontrado, solicitud de reapertura y chat.
- Rutas a pie/bicicleta/automóvil integradas con `/navigation/plan`, alternativas deduplicadas por el backend, selección, advertencias y desvíos configurables.
- Favoritos con nombre, etiquetas Premium, eliminación desde Perfil, historial privado y filtros/estadísticas Premium.
- Copias de rutas almacenadas por cuenta, con fecha y aviso de datos no actualizados. Consulta geométrica offline mediante SVG y caché del shell público en builds de producción. No se almacenan API, pruebas privadas ni documentos en el service worker.
- Durante recorridos, seguimiento GPS de la web, avisos de nuevos incidentes o incrementos de gravedad y decisión explícita del usuario sobre recalcular.
- Recomendaciones comerciales al pasar cerca de un negocio, sin modificar el trazado, sin repetir el mismo negocio durante el viaje. Proximidad/frecuencia/duración vienen del catálogo (valores iniciales: 50 metros, 150 metros recorridos y seis segundos).
- Ficha de negocio, visualizaciones de demostración y opción Premium para ocultar anuncios, persistida en el backend.
- Perfil, credibilidad, monedas, recuperación/cambio de teléfono con revisión administrativa y avisos de cuenta bloqueada.
- Alertas personales y marcado de lectura. Guía automática conectada a `/chatbot`, con consulta del número de incidentes y sin afirmar usar IA cuando no está configurada.
- Proxy de API del mismo origen, ejemplo de entorno, fuentes locales de sistema y scripts de lint/tipos/build.
- Puntos de participación mensuales e insignias por tres, diez y veinticinco reportes validados, consumidos desde `/participation` sin confundirlos con credibilidad o monedas.
- Salida standalone preparada para contenedores. Next.js y ESLint actualizados a 16.3.8 para corregir GHSA-vcvr-r3jv-pc5j.

## Verificaciones terminadas

- `npm --prefix frontend run lint`: correcto.
- `npm --prefix frontend run typecheck`: correcto.
- `npm --prefix frontend run build`: correcto; 17 rutas generadas, incluyendo `/incidentes/[id]` dinámica.
- GET local de `/`, `/mapa` y `/registro`: HTTP 200.
- `git diff --check -- frontend`: sin errores de whitespace.
- `npm audit --json` contra el registro oficial: cero vulnerabilidades después del parche de Next.js. Antes existía una vulnerabilidad crítica en Next 16.3.5.

## Verificaciones que dependen del bloque de integración

- Pruebas completas de interacción en navegador con el backend y la base local disponibles.
- GPS real en un dispositivo móvil, permisos de cámara y navegación durante un recorrido físico.
- Verificación SMS/WhatsApp/correo y evaluación con IA reales: requieren credenciales de proveedores.
- Tiles y estilo de Mapbox necesitan conexión y token público configurado. El esquema geométrico offline no pretende ser un mapa base descargado.
- El límite de archivos es 15 MiB y la interfaz informa el máximo de 30 segundos por video que valida el backend.

## Archivos principales

`frontend/lib/api.ts`, `frontend/lib/types.ts`, `frontend/components/AuthProvider.tsx`, `Shell.tsx`, `MapView.tsx`, `IncidentPanel.tsx`, `RoutePlanner.tsx`, `OfflineRoute.tsx`, `frontend/app/mapa/page.tsx`, `reportar/page.tsx`, `mis-reportes/page.tsx`, `perfil/page.tsx`, `alertas/page.tsx`, `verificar/page.tsx`, `frontend/app/globals.css`, `frontend/next.config.ts` y `frontend/public/sw.js`.

Los paneles de administración/agentes, ranking, recompensas y Premium se integran con estos módulos compartidos, pero tienen su propio bloque de desarrollo.

## Correcciones tras QA de integración

- La descripción del reporte es opcional, sin longitud mínima; conserva el máximo de 2000 caracteres y permite enviar una cadena vacía, acorde con el backend.
- La ficha comercial usa el campo `sitioWeb` del backend y muestra un enlace externo únicamente cuando contiene una dirección HTTP o HTTPS válida.
- Mis reportes distingue la fecha de envío de la fecha real de publicación del incidente cuando el backend la proporciona. El plazo de pruebas comienza desde la publicación; la reducción del día tres corresponde a ausencia de pruebas y las pruebas enviadas a tiempo mantienen el incidente visible hasta revisión.
- La capa de riesgo usa grosor proporcional al zoom y se ubica debajo de las etiquetas para preservar la lectura del mapa en móviles; los recorridos permanecen encima de las vías coloreadas.
- Los antecedentes importados y los incidentes resueltos que aportan riesgo histórico se identifican como «Antecedente histórico» en listado y detalle, con fecha del hecho y procedencia disponibles. Un reporte ciudadano activo no recibe esta etiqueta por pertenecer a un tipo que acumula riesgo histórico.
- Un acceso que devuelve `ACCOUNT_BLOCKED` recupera la sesión limitada creada por el backend y abre Mis reportes, donde se informa la restricción y permanece disponible la solicitud de revisión.

## Continuación: sesión, rutas locales y GPS

- Las respuestas de sesión obsoletas se cancelan y no pueden restaurar una cuenta tras cerrar sesión. La revocación pendiente se completa antes de otro acceso; cerrar sesión local funciona aunque el almacenamiento esté bloqueado y conserva un reintento en memoria.
- Cambiar de cuenta descarta estado privado, recorridos, favoritos y conversaciones anteriores. Los datos offline contienen únicamente una referencia de consulta; no habilitan permisos, teléfono verificado, credibilidad ni monedas.
- El guard de administración también descarta datos al cambiar cuenta, rol, distrito, tipo de agente o permisos, activando la cancelación de lecturas pendientes del panel.
- La caché comprueba geometrías, coordenadas, fechas, tiempos y niveles antes de mostrar recorridos. JSON inválido o almacenamiento inaccesible no rompen la página. Se mantiene el límite de una copia Free o veinte Premium por usuario.
- Cambiar origen, destino, transporte o desvíos invalida alternativas anteriores y cancela cálculos pendientes. Las coordenadas manuales conservan la edición como texto y las copias guardadas muestran una advertencia persistente de antigüedad.
- Los avisos de recorrido excluyen antecedentes importados e incidentes resueltos. El seguimiento se detiene si falta el GPS, se rechaza su permiso o devuelve datos inválidos; su limpieza ignora respuestas tardías y evita usar la posición del recorrido anterior.
- Lecturas de mapa, perfil, reportes y avisos cancelan respuestas anteriores al actualizar filtros, cambiar cuenta o desmontar la vista. Las sugerencias de lugares descartan resultados de consultas anteriores.
- Se agregó `npm --prefix frontend test`, con 17 pruebas sintéticas de carreras de sesión, logout offline, aislamiento y corrupción de caché, avisos históricos, GPS y cancelación de API. No se concedieron permisos ni se consultaron ubicaciones reales durante esas pruebas.

## Identidad visual y accesibilidad

- Los iconos, enlaces, bordes de edición, monedas y presentación de Premium consumen los colores de marca azul/celeste definidos en CSS. La ruta y el marcador GPS de Mapbox usan el color CSS resuelto para que el motor del mapa lo interprete correctamente.
- Se conservaron los seis colores de riesgo, los marcadores pendientes y los estados de éxito, error y peligro. El texto de los marcadores de gravedad 0–4 ahora es oscuro para mejorar contraste sin cambiar sus fondos.
- Los modos y alternativas de ruta comunican selección con `aria-pressed`; la leyenda comunica expansión y relaciona su contenido; la captura de archivos mantiene el control nativo enfocable mediante `sr-only`.
- Lint y TypeScript pasaron. No se agregaron pruebas de estilo ni se ejecutó build o reinicio en este bloque; la revisión visual conjunta queda a cargo de la integración del CSS y la cabecera.
- Lint, TypeScript y revisión de whitespace pasaron después de estas correcciones. La sesión de desarrollo continúa disponible para la revisión en navegador.

## Integración final del logo y recursos públicos

- Logo original integrado en portada, cabecera e iconos; capturas del último standalone guardadas en `docs/capturas/logo-escritorio.jpg` y `logo-movil.jpg`.
- Caché pública v4 con consulta de red y respaldo local; limpieza de la caché propia al volver a desarrollo. Tres regresiones nuevas verifican que el CSS actualizado prevalece, el logo funciona con fallo de red y las sesiones/evidencias/mutaciones no se interceptan.
- Resultado integrado: 20/20 pruebas frontend, lint y build aprobados. Cabecera comprobada a 320/375 píxeles sin desbordamiento. API, imagen e iconos responden HTTP 200 en el standalone local; consola final sin advertencias/errores.

## Verificación integrada de la paleta azul/celeste

- CSS y cabecera integrados; eliminados verdes decorativos, conservando colores semánticos. Se corrigió especificidad de bordes/fondo Premium y rol de botones de Mapbox.
- Resultado final: 20/20 pruebas, lint, TypeScript y build aprobados. Portada, Premium, mapa/ruta y adjuntos revisados en navegador; menú por Escape, salto al contenido, selección y marcadores por teclado comprobados. Portada a 320/375 píxeles sin desbordamiento.
- Capturas actuales en docs/capturas/identidad-azul-*.png; sin activar GPS/cámara ni cambiar base/backend/despliegue.

## Iconos de incidentes proporcionados por el propietario

- Integrados los 15 PNG de `frontend/iconos` mediante imports estáticos y un componente compartido. Se muestran en mapa, lista pública, detalle, tipo seleccionado al reportar, Mis reportes, revisión de administrador/agente y catálogo administrativo.
- La correspondencia usa los tipos del catálogo; hurto, amenazas, extorsión, humo, pelea, animal peligroso y otro conservan un símbolo neutro junto al nombre. El selector mantiene sus categorías nativas. Los iconos son decorativos cuando el nombre ya está visible; el marcador conserva nombre accesible, número y color de gravedad, independientes del riesgo del tramo.
- Los PNG originales permanecen intactos (17.292.129 bytes en conjunto). Next sirve imágenes optimizadas también en los marcadores DOM de Mapbox. Los 15 recursos probados devolvieron HTTP 200 en WebP, entre 1.632 y 2.830 bytes por icono. El marco de Calle bloqueada compensa sus márgenes transparentes mediante CSS.
- Validación: 20/20 pruebas frontend; lint, TypeScript, build y diff --check aprobados. Navegador con base/API locales: 15 imágenes cargadas y siete símbolos neutros en catálogo, detalle abierto por Enter, Mis reportes y formulario comprobados. Vista de 320 píxeles sin desbordamiento; sin usar GPS/cámara ni enviar nuevos reportes.
- La base local experimental devolvió errores transitorios P1001 durante la revisión inicial; API/ready y navegación vial volvieron a HTTP 200 y el mapa recuperó su capa vial. Consola final revisada sin errores/advertencias. No hubo cambios de backend o base.
- Evidencia en `docs/capturas/iconos-incidentes-escritorio.png`, `iconos-incidentes-movil.png` e `iconos-catalogo.png`. La compilación actual continúa en localhost:3000; despliegue público pendiente.
