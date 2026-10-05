# CiviGo — Registro de desarrollo autónomo

Inicio: 1 de octubre de 2026, America/Lima.

## Decisión vigente del 4 de octubre

La verificación telefónica y el panel ADMIN web descritos en etapas anteriores se reemplazan por Gmail/Google y la aplicación de administración Windows. El teléfono queda como contacto privado; correo verificado habilita participación y elegibilidad de publicación. Los agentes conservan `/agente`. La [entrega vigente](entrega-gmail-escritorio-20261004.md) detalla cambios, pruebas, dos cuentas de demostración solicitadas y configuración externa pendiente; los apartados siguientes conservan el historial del trabajo.

## Alcance y límites

Implementar y verificar los requisitos de `especificacion-funcional.md` respetando los cambios que ya existían. No desplegar, cambiar infraestructura externa, publicar ni modificar credenciales. Configurar integraciones mediante variables documentadas y declarar la falta de proveedor cuando corresponda.

## Estado inicial

- Prototipo Next.js/Express/Prisma con base PostgreSQL de Supabase.
- Cambios anteriores presentes en frontend y backend; se conservarán sus funcionalidades útiles.
- Sin pruebas ni autenticación completa; mapa y formulario parcialmente conectados.
- Existen archivos de entorno de backend y frontend. Solo se ha comprobado la presencia de nombres de variables; no se imprimen sus valores.
- Hay dependencias incluidas en Git: evitar cambios accidentales y excluir secretos de nuevas entregas.

## Trabajo distribuido

- Backend: autenticación, catálogo, reportes, incidentes, pruebas/archivos, chats, permisos, revisión, reputación, recompensas, anuncios y servicios.
- Frontend ciudadano: cuentas, formulario por categorías, mapa, rutas, perfil, notificaciones y asistente.
- Paneles: agente/administrador, ranking, recompensas y Premium de demostración.
- Integración: red vial real, puntos por tramos, alternativas de rutas, favoritos/historial, configuración y comprobaciones completas.

## Contrato de navegación

- `GET /api/navigation/roads`: GeoJSON FeatureCollection de tramos; propiedades `id`, `nombre`, `puntos`, `nivelRiesgo`, `pendiente`.
- `GET /api/navigation/places?q=...`: sugerencias `{nombre,latitud,longitud}`.
- `POST /api/navigation/plan`: `{origen:{latitud,longitud},destino:{latitud,longitud},modo:"walking"|"cycling"|"driving"}`.
- Respuesta: `{rutas:[{id,nombre,tipo,distancia,duracion,geometria,puntosRiesgo,nivelRiesgo,advertencias}],cobertura,fuente}`. Metros y segundos; geometría GeoJSON LineString.
- `GET/POST/DELETE /api/navigation/favorites`: favoritos del usuario, con límites de plan.
- `GET/POST /api/navigation/history`: historial privado del usuario.
- La navegación necesita cuenta, no teléfono verificado. Ninguna ruta se inventa si el proveedor está indisponible.

## Completado

- Inspección inicial de arquitectura, documentación, cambios previos y configuración disponible.
- Distribución de archivos y acuerdos de integración entre agentes.
- Registro con edad mínima, contraseñas scrypt, sesiones HttpOnly, acceso público al mapa y verificación para participar.
- Catálogo de siete categorías y 22 tipos, distritos, permisos, flujos individual/comunitario, agrupación 50 m/3 h, votos únicos, resolución, chat, pruebas privadas y revisión humana.
- Paneles de agentes y administradores: permisos/distritos, catálogo, plazos, revisión, apelaciones, recuperación de teléfono, auditoría, configuración, negocios, premios y cierre mensual.
- Credibilidad, puntos mensuales, primeras insignias, monedas, empates, ajustes administrativos justificados, stock y canjes de demostración.
- Riesgo por tramos reales de OpenStreetMap: gravedad directa, validación, envejecimiento histórico y 15 % en conexiones directas, conservando decimales y señalando gravedad pendiente.
- Calles y catorce límites distritales/provincial de Ica descargados de OpenStreetMap, sin geometrías ficticias.
- Rutas a pie/bicicleta/auto con distancia/exposición, alternativas deduplicadas, desvíos ampliables, favoritos 3/20, historial privado y estadísticas Premium.
- Alertas de nuevos incidentes en el recorrido, elección de recalcular, GPS durante la web abierta, tarjetas de negocios 50 m, separación y duración configurables, impresión única por negocio/recorrido.
- Consulta local de recorridos con fecha y modo de solo lectura sin conexión; no se guardan respuestas API, sesiones ni documentos privados en el service worker.
- Históricos CSV/JSON: vista previa, validación de fechas de Lima/coordenadas/tipo, procedencia e importación idempotente. Ningún histórico real se inventó.
- Adaptadores opcionales SMS/WhatsApp, correo e IA; guía local identificada cuando no hay IA. Modo demo restringido fuera de producción.
- Migración aditiva y catálogo aplicados a Supabase de prueba. Se respetó `fechaNacimiento`, que existía por una migración previa, y se conservaron tablas antiguas.
- Scripts de desarrollo, administrador inicial explícito, tareas de plazos, Dockerfiles/Compose y comprobaciones CI preparados; sin despliegue.
- Dependencias y archivos de entorno retirados del seguimiento de Git, conservando los archivos locales. Next actualizado desde 16.3.5 al parche 16.3.8 por una vulnerabilidad detectada en auditoría.
- Fecha de publicación separada de creación/hecho, reapertura con plazos coherentes, puntos de pruebas posteriores a validación sin duplicados y documentos de identidad excluidos de esos puntos.
- Mapa conserva incidentes activos frente a grandes importaciones de antecedentes; históricos muestran fecha y procedencia. Inicio de sesión limitado para cuentas bloqueadas permite consultar y apelar.
- Adaptador de PGlite local reparado para no detener su cola, retener conexiones cerradas ni desincronizar Prisma después de un error. Versión compatible fijada y cuatro regresiones específicas.
- Lanzador completo probado; web fijada en puerto 3000, API en 4000 y base local configurable. Se cierran servicios relacionados si falla uno; no se modifican archivos de entorno.

## Verificaciones finales

- Suite completa: **70/70 aprobadas, cero fallos y cero omisiones**, en una base local aislada con las siete migraciones y el adaptador reparado. Incluye HTTP, administración, archivos, premios, ranking, mapa, riesgo, navegación, cobertura, proveedores y protocolos del ayudante local.
- Supabase de prueba: flujos HTTP y ocho bloques de gestión verificados; se corrigió el plazo de una transacción remota y se repitieron específicamente agrupación del quinto reporte, prevalencia del agente y puntos por pruebas posteriores a validación. Fixtures remotos propios limpiados.
- Backend: sintaxis y validación de Prisma aprobadas. Frontend final: lint sin advertencias, TypeScript y build Next 16.3.8 aprobados; diecisiete páginas estáticas y una dinámica.
- Auditorías backend/frontend: cero vulnerabilidades conocidas tras las correcciones.
- Navegador: cuenta/sesión, reporte con descripción vacía, chat, favoritos y ruta; administrador valida, resuelve, reabre y actualiza contadores. Pantallas revisadas en escritorio y móvil, sin desbordamiento horizontal.
- Build standalone probado en localhost con API real: mapa y ruta de aproximadamente un kilómetro/trece minutos; `/api/ready` y `/sw.js` HTTP 200, consola final sin advertencias/errores.
- Lanzador `--local --demo`: prepara base, conserva credenciales demo existentes y arranca web/API en sus puertos correctos. Mapa, catálogo, calles, salud y disponibilidad de base responden HTTP 200. Un puerto local inválido se rechaza antes de arrancar.
- Compose y revisión de Git: `docker compose config --quiet` y `git diff --check` aprobados. Motor Docker no respondió; construcción de imágenes pendiente.
- Capturas guardadas en `docs/capturas/`; corresponden a datos locales de prueba. Informe completo en `docs/entrega-desarrollo.md`.

## Pendiente tras la entrega

- Elegir/configurar proveedores y comprobar SMS/WhatsApp, correo e IA reales.
- Elegir cuenta propia `ADMIN_EMAIL` para primer administrador e importar una fuente histórica real cuando se entregue.
- Revisar GPS, cámara, video y desconexión total en un dispositivo físico; revisar datos de navegación para el piloto.
- Validar contenedores cuando Docker tenga un motor operativo. Despliegue/HTTPS/dominio en una tarea posterior autorizada; pagos reales fuera de esta demostración.

## Bloqueos conocidos

- No hay proveedores de SMS/WhatsApp, correo ni IA elegidos. Preparar adaptadores y errores claros; cualquier simulación será local y explícita, nunca habilitada silenciosamente en producción.
- No se ha autorizado el despliegue en esta etapa.
- PGlite Socket se corrigió en el ayudante de desarrollo y se verificó con Prisma. Mantiene una sola conexión y no reemplaza PostgreSQL normal para concurrencia/producción. Detener la API antes de conectar CLI/migraciones a ese ayudante.
- Docker instalado, pero su motor no respondió después de intentar iniciarlo en segundo plano. Se validó la configuración de Compose; no se afirma que las imágenes se hayan construido.
- El primer administrador real requiere que el propietario seleccione `ADMIN_EMAIL` de una cuenta propia registrada. No se escoge una identidad ni se modifica una contraseña existente automáticamente.
- El archivo de entorno del backend había estado seguido en Git. Retirarlo del seguimiento actual no borra versiones antiguas del historial; revisar y rotar sus credenciales antes de publicar el repositorio.

## Decisiones iniciales configurables

- Mantener la arquitectura existente.
- Separar gravedad, puntos de calle, credibilidad, puntos mensuales y monedas.
- Límites iniciales de desvío: 25 % intermedia y 50 % más segura.
- Resolver detalles rutinarios conservadoramente, documentando los valores empleados.
- Puntos iniciales: reporte 10, confirmación 2, prueba 3; primeras tres autorías 100/75/50 %. Premios mensuales iniciales: 100/80/60/50/40/30/20/15/10/5 monedas, ajustables.
- Insignias provisionales a 3/10/25 reportes validados. La credibilidad sigue separada de puntos, monedas e insignias.
- Publicidad inicial: 150 m entre tarjetas y 6 segundos, configurable; selección del negocio más cercano, sin repetición en un viaje. Banner de demostración en el panel del mapa.
- Pruebas entregadas a tiempo conservan su peso y esperan revisión; no se retiran por demora del personal. Los reportes sin prueba bajan al tercer día y se retiran al séptimo.
- Históricos fuera de tres años se conservan en base, sin puntos; fecha sin hora importada se interpreta a las 00:00 de Lima.
- Una calle bloqueada validada se excluye del trazado; otros incidentes graves y pendientes generan avisos para la decisión del usuario.

La demostración local de revisión usa `.local/migration-validation-20261001`, puerto de base 55435 y cuentas `@demo.civigo.local`. El comando normal sigue usando la configuración de Supabase conservada. No se realizó commit, push, publicación ni despliegue.

## Continuación de la revisión — 1 de octubre

- Se recibió el logo oficial. Se conservan sus bytes originales en `frontend/public/civigo-logo.jpeg`, `app/icon.jpg` y `app/apple-icon.jpg`; cabecera y portada lo utilizan. Se reemplazó el favicon inicial de Next y se añadió el logo a la caché pública, sin alterar los colores de riesgo.
- La API de calles omite los tramos fuera de cobertura. El cálculo de rutas respeta las excepciones de sentido único para peatones/bicicletas y convierte velocidades con unidades, rechazando valores inválidos.
- La importación histórica interpreta fechas sin zona en Lima, valida tipos JSON y referencias sin truncarlas, y prepara inserciones por lotes con referencias a IDs asignados por la secuencia de PostgreSQL.
- Verificación aislada de esta continuación: catorce pruebas de navegación/importación aprobadas; tres pruebas HTTP/base aprobadas, incluida la importación de 2.000 registros, su repetición sin duplicados y sus referencias correctas. Las siete migraciones se aplicaron a la base local separada de puerto 55440.
- Completados: sesiones y lecturas privadas ante cambios de cuenta/permisos, invalidación y caché de rutas, errores de GPS, cuotas por cuenta y proxy explícito, chat reciente, publicación/confirmaciones, sanciones grupales y apelaciones. La retirada de puntos requiere ADMIN y razón; su restauración conserva fecha/importe y no altera cierres liquidados.
- Operación: preparación local versionada, baseline interrumpida recuperable sin pérdida de datos, primer administrador único bajo concurrencia, contextos Docker privados excluidos, CI con construcción/comprobaciones de contenedores y ejemplo Nginx sin activar infraestructura externa.
- Resultado final de la continuación: **93/93 backend y 20/20 frontend**, cero omisiones; sintaxis, lint, TypeScript, build, Compose y revisión de diff aprobados. La suite completa incluye la importación de 2.000 filas y cuatro regresiones operativas. CLI real de preparación y repetición idempotente aprobadas.
- Lanzador local completo verificado de nuevo con credenciales demo existentes conservadas. El último standalone se inició en localhost con API/base reales de prueba; logout, cambio de cuenta, protección de panel y ruta manual se comprobaron en navegador. El logo y sus iconos responden HTTP 200; capturas nuevas de portada en escritorio y móvil.
- Se corrigió la caché antigua de recursos de desarrollo. El worker final es v4: consulta de red con respaldo local solo para recursos públicos; se conserva la exclusión de API, sesiones y documentos. La cabecera del build entra en 320/375 píxeles y la consola final quedó sin errores/advertencias.
- No quedan tareas locales identificadas sin resolver en este bloque. Permanecen los pendientes de proveedores, administrador propio, fuente histórica, revisión física y motor Docker de la primera entrega; no se desplegó ni se creó otra migración.
- Última comprobación de escucha: API nativa limitada a `127.0.0.1`, disponible a través del standalone con HTTP 200. Docker conserva escucha interna `0.0.0.0` y publicación del puerto exclusivamente en loopback. Se actualizaron ejemplos y documentación, y Compose volvió a validar.

## Identidad del logo y accesibilidad — 1 de octubre

- Solicitud del propietario: utilizar los colores azul/celeste de su logo y aplicar mejoras adicionales coherentes. Se centralizó la paleta en variables CSS; botones, enlaces, iconos, selección, paneles y Premium usan los mismos tokens. Se conservó la imagen oficial y los colores semánticos de riesgo, éxito, error y advertencia.
- Textos secundarios, controles y marcadores con contraste corregido; foco visible, enlace Saltar al contenido, página actual en navegación y menú móvil con estado anunciado/cierre por Escape. Modos y alternativas anuncian selección; la leyenda conserva una referencia existente incluso cerrada.
- El control nativo de archivos continúa enfocable; su contenedor muestra foco. Mapbox asignaba rol de imagen al marcador personalizado: se restaura rol de botón después de construirlo y Enter abre el incidente. La ruta/GPS reciben un color CSS resuelto que Mapbox interpreta.
- Corregida la cascada CSS entre Tailwind y tarjetas para que el borde de edición y el fondo Premium azul claro realmente se apliquen. Contrastes: botón principal 6,38:1, texto secundario 5,91:1 y borde de controles 3,34:1 sobre blanco.
- Validación final: 20/20 pruebas frontend, lint, TypeScript, build y git diff --check aprobados. Navegador con API/base locales reales: portada a 320/375 píxeles sin desbordamiento, foco y salto al contenido, menú por Escape, Premium, selección de transporte/recorrido, leyenda, marcadores por Enter y acceso a adjuntos por Tab. Recorrido de ejemplo de 1 km/13 minutos dibujado en azul; no se activaron GPS/cámara reales.
- La actualización del mapa mostró un error transitorio durante el reinicio de la vista previa; se repitió correctamente, conservando el manejo de datos anteriores y sin errores/advertencias en la consola final revisada. No hubo cambios de backend, base, infraestructura ni despliegue en este bloque.
- Capturas actuales: docs/capturas/identidad-azul-escritorio.png, identidad-azul-movil.png e identidad-azul-mapa.png. La compilación final continúa en localhost:3000 con base de demostración separada; los bloqueos externos ya documentados siguen pendientes.

## Iconos propios y alojamiento confirmado — 1 de octubre

- Integrados los 15 PNG recibidos en `frontend/iconos` sin modificar los originales. Mapeo compartido por tipo; componente para listas, detalle, formulario, reportes y panel administrativo/agente. Marcadores de Mapbox usan las mismas imágenes optimizadas y conservan número/color de gravedad y activación por teclado.
- Siete tipos aún carecen de PNG: hurto, amenazas, extorsión, humo, pelea, animal peligroso y otro. Se usa representación neutra con nombre; no se confunden con delitos o emergencias diferentes.
- 20/20 pruebas frontend, lint, TypeScript, build y diff --check aprobados; 15/15 recursos optimizados HTTP 200 y cargados en navegador. Verificados catálogo, formulario, Mis reportes, marcador/detalle por Enter y ancho móvil 320 sin desbordamiento. Capturas `docs/capturas/iconos-*.png`; sin nuevos reportes ni permisos GPS/cámara.
- Se confirmó y documentó el stack solicitado: Vercel (frontend), Railway (API Node.js), Supabase (base), GoDaddy (dominio). Configuración en proveedores y despliegue siguen pendientes; no se cambió infraestructura ni se publicó.
