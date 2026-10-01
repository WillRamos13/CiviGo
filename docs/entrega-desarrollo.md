# Entrega de desarrollo autónomo — CiviGo

1 de octubre de 2026. Se conserva Next.js, Express, Prisma y PostgreSQL de Supabase. El proyecto compila y los flujos centrales se verificaron mediante pruebas y navegador. No se desplegó ni publicó a producción. Hay servicios externos que necesitan configuración del propietario antes de usarlos con personas reales.

## 1. Funcionalidades implementadas

### Cuentas y participación

- Registro con nombres, apellidos, alias, correo, teléfono, contraseña y edad mínima de doce años; contraseñas protegidas con scrypt y sesiones mediante cookies HttpOnly.
- Mapa público. Las cuentas pueden calcular rutas sin verificar el teléfono; publicar, confirmar y participar exige verificación.
- Roles ciudadano, agente y administrador; permisos asignados por administrador, agentes por distrito y colaboradores con alcance provincial.
- Perfil, verificación de teléfono, recuperación mediante correo o revisión de identidad, notificaciones y sesión limitada para cuentas bloqueadas que necesitan consultar sus reportes y apelar.
- Datos personales y pruebas privadas protegidos por autorización. El ranking y el mapa usan alias y no exponen identidades.

### Reportes e incidentes

- Siete categorías y veintidós tipos configurables. Descripción opcional, ubicación confirmada, corrección máxima de cincuenta metros y hechos anteriores permitidos según el tipo y el plazo acordados.
- Reportes individuales para robo, hurto, intento de robo, amenazas y extorsión; pruebas privadas, revisión por personal y plazos de publicación/pruebas separados de la fecha del hecho.
- Agrupación comunitaria por tipo, hasta cincuenta metros y tres horas; chat único, autores conservados y prevención de duplicados del mismo usuario.
- Tres confirmaciones ciudadanas o una revisión autorizada para validar; cinco confirmaciones de resolución o revisión autorizada para retirar un incidente activo. Se verifica cercanía y unicidad de votos.
- Gravedad humana prevalente; gravedad máxima al agrupar cuando todavía no existe una decisión humana. Una emergencia sin IA o agente aparece por evaluar, sin inventar gravedad; otros tipos esperan revisión.
- Hasta tres fotos/videos, con validación de firma, tamaño, privacidad y duración inferior a treinta segundos. Documentos de identidad separados de las pruebas del hecho.
- Chat, control de spam, alertas de posible falsedad, investigación, apelaciones, resolución y reapertura trazables.
- Credibilidad inicialmente sin definir; faltas confirmadas por revisión humana reducen a 70, 40 y 20 y bloquean en la cuarta. Se conserva el acceso necesario para apelar.
- Revisión automática de plazos y recordatorios. Una prueba entregada a tiempo espera revisión y no caduca porque el personal tarde.

### Mapa, riesgo y navegación

- Red vial real de OpenStreetMap para la provincia y sus catorce distritos: aproximadamente 36 500 tramos de calles, descargados con atribución y licencia documentadas.
- Cálculo por tramos y conexiones directas: gravedad usada como puntos base, confianza, antigüedad histórica y transferencia del quince por ciento a tramos conectados. No hay propagación recursiva.
- Nivel cero para cero puntos; niveles uno a cinco en intervalos de cinco, con decimales que entran al siguiente intervalo cuando superan el límite. La gravedad del hecho, el nivel del tramo y la exposición de una ruta se muestran como conceptos distintos.
- Reducción histórica de 100/75/50/25/10 % y exclusión del mapa/puntos después de tres años, conservando registros. Los hechos sin gravedad no se muestran como si estuvieran confirmados seguros.
- Rutas a pie, bicicleta y automóvil con accesos, sentidos y cobertura; alternativas más corta, equilibrada y más segura cuando son diferentes. No se inventan líneas rectas si no existe un recorrido.
- Límites de desvío configurables, advertencias, historial privado, favoritos y recorridos precargados con fecha. La consulta sin conexión funciona en modo de lectura; no se guardan pruebas, sesiones ni respuestas privadas en el service worker.
- Seguimiento por GPS mientras la web está abierta, alerta ante nuevos incidentes y opción de recalcular. Las duraciones son estimadas, sin tráfico en vivo ni navegación giro a giro.
- Importación administrativa de históricos CSV/JSON con vista previa, validación, procedencia e idempotencia. No se cargaron históricos reales ficticios ni se inventó una conexión a DATACRIM.

### Gestión, comunidad y demostraciones

- Paneles de agente y administrador: revisión, pruebas privadas, plazos, resolución, reapertura, apelaciones, recuperación de teléfono, permisos, distritos, catálogo y auditoría.
- Puntos mensuales, insignias, ranking, monedas separadas de la credibilidad, reparto de empates y cierre mensual idempotente. Ajustes administrativos justificados y saldos no negativos.
- Premios con stock, solicitudes de canje y evaluación administrativa. No hay entrega comercial automática ni pagos reales.
- Negocios y publicidad: ficha, banner, tarjetas cuando el usuario pasa cerca de negocios de su recorrido, separación/distancia/duración configurables y registro de visualizaciones. Los anuncios no influyen en el cálculo de rutas.
- Premium de demostración administrado: más favoritos, recorridos precargados, etiquetas/estadísticas y opción de desactivar recomendaciones durante el recorrido. No se implementaron cobros, de acuerdo con el alcance.
- Adaptadores opcionales para Twilio Verify, Resend e IA compatible con OpenAI; respuestas explícitas cuando falta configuración. El asistente distingue su guía local de una respuesta de IA.
- Logo oficial recibido del propietario: portada, cabecera, icono del navegador y Apple Touch Icon. Se utiliza la imagen original y se incluye en la caché pública.
- Identidad azul/celeste del logo aplicada a botones, enlaces, selección, iconos, formularios, paneles, Premium y trazado de rutas. Los colores de riesgo y de éxito/error/advertencia conservan su significado. Foco visible, salto al contenido, menú accesible y selección anunciada para lectores de pantalla.
- Revisión explícita `RETIRAR_PUNTOS` para administradores en incidentes declarados falsos, con motivo y auditoría. La falsedad afecta credibilidad; la retirada de puntos requiere una decisión administrativa separada. Las monedas liquidadas se revisan mediante el ajuste administrativo existente.

## 2. Archivos principales

- `backend/prisma/schema.prisma` y migraciones `20261001090000_civigo_workflows` y `20261001143000_incident_publication`: datos, permisos, sesiones, pruebas, recompensas, anuncios y publicación. Ambas migraciones nuevas se aplicaron a Supabase de prueba de forma aditiva.
- `backend/src/routes/`: usuarios, reportes, incidentes, archivos, administración, comunidad, navegación, participación, históricos y comprobaciones operativas.
- `backend/src/lib/`: autorización, validación, plazos, servicios opcionales, riesgo, calles, navegación, recompensas, insignias e importación.
- `frontend/app/`: cuentas, mapa, reportes, detalle, alertas, perfil, administración, agentes, ranking, recompensas y Premium.
- `frontend/components/` y `frontend/lib/`: sesión, formularios, mapa, rutas, revisión administrativa, tipos compartidos y manejo de errores.
- `frontend/app/globals.css`, `app/layout.tsx`, `components/Shell.tsx`, `MapView.tsx`, `RoutePlanner.tsx` y `RiskLegend.tsx`: paleta centralizada, color del navegador y controles accesibles. Portada y pantallas de gestión utilizan estos colores.
- `backend/tests/`, `scripts/dev.js`, `backend/scripts/`, ejemplos de entorno, `.gitignore`, Dockerfiles, `compose.yaml` y `.github/workflows/checks.yml`: ejecución, pruebas y preparación de operación.
- `docs/`: especificación, registros detallados, este informe, operación y capturas de escritorio/móvil.

## 3. Bugs corregidos

- El formulario exigía una descripción aunque debía ser opcional.
- Los contadores administrativos no se actualizaban después de revisar/resolver un incidente.
- Los plazos se calculaban desde la creación, confundiendo revisión pendiente y publicación; se añadió fecha de publicación y reapertura coherente.
- Confirmaciones, premios, cierre mensual y cambios de estado necesitaban controles de concurrencia e idempotencia.
- Una prueba de un hecho validado no concedía los puntos al adjuntarla después; ahora se concede una vez. Los documentos de identidad no suman puntos de pruebas.
- Las solicitudes de OTP podían competir, reutilizarse o verificar un teléfono que había cambiado; ahora se comprueba vigencia, consumo y destinatario.
- El acceso limitado de una cuenta bloqueada no se reflejaba correctamente al ingresar desde el frontend.
- Una importación grande de históricos podía desplazar incidentes activos de la consulta del mapa.
- Se corrigieron navegación dentro de cobertura, accesos de cada medio de transporte, segmentos cortados, proyección de puntos, fechas de Lima y límites exactos de caducidad.
- Las capas de riesgo dificultaban leer los nombres de calles; ahora se ajustan al zoom y respetan el orden de etiquetas.
- Next.js tenía una vulnerabilidad detectada por auditoría; se actualizó a 16.3.8. Backend y frontend quedaron sin vulnerabilidades conocidas en las auditorías ejecutadas.
- Dependencias y archivos de entorno estaban incluidos en Git; se retiraron del seguimiento conservando los archivos locales. El historial antiguo requiere revisión antes de publicar.
- Se repararon fallos del adaptador local de conexiones y desincronización de Prisma. El lanzador compartía por error el puerto de la API con Next; ahora fija 3000 para la web, respeta el puerto local elegido y cierra los demás servicios si falla uno.
- Las respuestas tardías de sesión y las lecturas privadas podían conservar datos de otra cuenta. Ahora se cancelan o descartan; las vistas administrativas se reinician también al cambiar permisos o alcance.
- Cambiar origen, destino, transporte o desvíos podía conservar alternativas antiguas; se invalidan. La caché descarta registros dañados y respeta la cuenta y su límite. Un GPS ausente, denegado o inválido detiene el seguimiento; los históricos no generan falsas alertas de emergencia nueva.
- Un aporte remoto podía confirmar un incidente usando sus coordenadas, en lugar de la posición actual. Se corrigió; un caso ordinario sin publicar tampoco otorga puntos por acumular tres aportes.
- El chat devolvía los primeros doscientos mensajes y ocultaba los recientes. Ahora devuelve los últimos doscientos en orden de lectura, conserva el control de spam y vuelve a comprobar permisos dentro de la operación.
- Las apelaciones de incidentes agrupados podían revertir la sanción de un solo autor. Ahora revisan a todos los autores afectados, preservan bloqueos manuales y restauran puntos retirados con su importe y fecha originales. Un cierre mensual no se recalcula ni premia de nuevo el mismo aporte.
- Los límites de solicitudes compartían la IP del proxy y la importación histórica podía quedar fuera de ellos. Ahora existen cuotas por sesión/cuenta y rutas normalizadas, validación de origen y confianza explícita en proxies.
- Las calles fuera de cobertura podían recibir color de riesgo. Se excluyen; se corrigieron excepciones de sentido único por transporte, unidades de velocidad y valores inválidos. Las fechas históricas sin zona se interpretan en Lima y una importación de dos mil filas utiliza inserciones por lotes con referencias exactas.
- La preparación local usaba sincronización de esquema sin historial. Ahora usa migraciones; una base antigua se incorpora con un marcador recuperable y sin aceptar pérdida de datos. La espera del lanzador evita cargar antes la DLL de Prisma en Windows. Dos preparaciones concurrentes del primer administrador dejan una sola cuenta promovida.
- Una caché de recursos podía mostrar CSS/JS anteriores al volver al servidor de desarrollo. Se añadió limpieza de la caché propia y consulta de red con respaldo local para recursos públicos. La cabecera se ajustó también a pantallas de 320 píxeles.
- La interfaz conservaba colores verdes de marca que no correspondían al logo. Se sustituyeron por azul/celeste; los textos pequeños y números de marcadores tenían poco contraste. Se corrigió también la cascada CSS que ocultaba bordes/fondos de marca en tarjetas.
- El selector de adjuntos no recibía foco de teclado y Mapbox asignaba rol de imagen a botones de incidentes. Ahora los adjuntos mantienen el control nativo enfocable y los marcadores se anuncian como botones; Enter abre el detalle.

## 4. Pruebas y resultados

- Suite completa final del backend: **93 pruebas aprobadas, cero fallos y cero omisiones**, sobre una base aislada con las siete migraciones. Incluye integridad HTTP, seguridad, restauración de puntos, importación idempotente de 2.000 registros y cuatro pruebas operativas. Se conservaron las regresiones del adaptador local.
- Frontend: **20 pruebas sintéticas aprobadas, cero fallos y cero omisiones** para sesiones, cambios de cuenta, cancelación de solicitudes, caché, seguimiento GPS y recursos públicos sin conexión. No representan una prueba de ubicación física.
- Tras el ajuste azul/celeste se repitieron las veinte pruebas del frontend, lint, TypeScript y build: aprobados. Navegador: portada a 320/375 píxeles sin desbordamiento, salto al contenido, cierre de menú con Escape, Premium con fondo/borde correctos, selección de transporte/ruta, leyenda, marcador mediante Enter y foco de adjuntos. Recorrido manual de 1 km/13 minutos representado en azul; sin usar GPS/cámara reales. La actualización del mapa se repitió después del reinicio local y la consola final no mostró errores/advertencias. Backend/base sin cambios en este bloque.
- Se verificaron además autenticación, agrupación, votos, delitos individuales, permisos y gestión contra Supabase de prueba. Una transacción remota excedió su plazo inicial; se corrigió y se repitió específicamente la regresión del quinto reporte agrupado y premios por archivos, con resultado satisfactorio.
- `npm run check`, validación de Prisma, lint, TypeScript y build del frontend: aprobados. El último build generó diecisiete rutas estáticas, incluyendo ambos iconos, y una dinámica.
- Auditorías de dependencias: cero vulnerabilidades conocidas en backend/frontend al realizar la entrega.
- Navegador con API real: ingreso, publicación sin descripción, chat, favoritos, recorrido, validación, resolución, reapertura y actualización de contadores; escritorio y vista móvil sin desbordamiento horizontal en las pantallas revisadas.
- Build standalone iniciado y probado en localhost: mapa y recorrido de aproximadamente un kilómetro/trece minutos, `/api/ready` y `/sw.js` responden HTTP 200; sin errores/advertencias de consola en la vista final revisada.
- Lanzador `node scripts/dev.js --local --demo` comprobado con base separada: preparación, preservación de cuentas existentes, web en 3000/API en 4000 y respuestas HTTP 200 para mapa, catálogo, calles, salud y disponibilidad. Puerto local inválido rechazado antes de crear procesos.
- La continuación comprobó logout, ingreso con otra cuenta, bloqueo del panel administrativo sin sesión, recorrido de 1 km/13 minutos y descarte de selección al cambiar a automóvil. El último standalone sirvió el logo, ambos iconos, la API y el service worker v4; portada a 320/375 píxeles sin desbordamiento y consola final sin advertencias/errores.
- CLI local real: generación de Prisma, siete migraciones, semilla y segunda preparación sin pendientes. La regresión de baseline interrumpida conserva el usuario y completa las fechas de publicación. Un bloqueo de DLL causado por otra suite concurrente se resolvió al terminar esos procesos; no se omitió generación.
- `docker compose config --quiet` y `git diff --check`: aprobados. El motor de Docker no respondió; no se pudo validar la construcción de imágenes.
- Las credenciales de proveedores no están disponibles: se prueban adaptadores y condiciones de fallo, sin afirmar que se enviaron SMS, WhatsApp o correos reales ni que se verificó IA externa.

## 5. Qué se comprobó y sus límites

Las pruebas cubren permisos de endpoints, aislamiento de datos, publicación, agrupación, votos únicos, prevalencia del agente, plazos, bloqueo/apelación, archivos, recompensas, ranking/empates, ajustes, negocios, históricos, navegación y riesgo. La revisión visual comprobó que el frontend consume la API y representa los cambios de estado.

GPS real, cámara, videos capturados en un teléfono y comportamiento sin conexión total requieren revisión en un dispositivo físico. Se comprobó el código y la entrega del service worker, pero no se simula esa revisión física como si hubiera ocurrido. Las calles de OSM pueden tener restricciones o cambios que aún no estén registrados.

## 6. Decisiones técnicas

Se mantuvo la arquitectura existente y se añadieron funciones sobre sus módulos, sin sustituir innecesariamente el proyecto. Las migraciones nuevas son aditivas; se conservó una columna anterior que ya existía en Supabase. No se modificaron las credenciales existentes.

Valores iniciales configurables: puntos de reporte/confirmación/prueba 10/2/3; primeras tres autorías de un incidente agrupado 100/75/50 %; premios mensuales iniciales 100/80/60/50/40/30/20/15/10/5 monedas; insignias a 3/10/25 reportes validados; desvíos equilibrada/segura 25/50 %; publicidad cada 150 m durante seis segundos. Estas decisiones se pueden revisar desde configuración.

La API comprueba permisos y calcula puntos en servidor. Las evidencias privadas se sirven desde endpoints autorizados. El servidor local opcional conserva una conexión; Supabase/PostgreSQL continúa siendo la base normal.

La paleta se centraliza en variables CSS: azul principal `#1554d8`, celeste decorativo `#23bdeb`, fondo de selección `#eaf2ff` y texto secundario `#52667c`. Blanco sobre el botón principal alcanza contraste 6,38:1; texto secundario sobre blanco, 5,91:1. El celeste no se usa para texto blanco pequeño. Los colores originales del logo y la escala de riesgo no se modificaron.

La última revisión no requiere otra migración. Las retiradas por falsedad son explícitas y exclusivas del administrador; las apelaciones restauran la fecha original de los puntos y conservan cierres mensuales ya liquidados. El proxy solo se considera confiable cuando su IP/CIDR se configura y sobrescribe las cabeceras entrantes; el ejemplo preparado está en `deploy/nginx.conf.example`.

La API nativa escucha en `127.0.0.1` por defecto y acepta `API_HOST` explícito. Docker utiliza `0.0.0.0` dentro del contenedor, con el puerto del host limitado a loopback por Compose. Se verificó el arranque nativo final: dirección `127.0.0.1` y `/api/ready` a través de la web con HTTP 200.

## 7. Pendientes de alcance o configuración

- Elegir/configurar SMS o WhatsApp, correo e IA con claves del propietario y probar los envíos reales.
- Registrar una cuenta propia y seleccionar `ADMIN_EMAIL` para preparar el primer administrador real.
- Proporcionar la fuente histórica real para importarla y revisar datos/cartografía para el piloto.
- Probar GPS, cámara y desconexión en teléfono físico; decidir productos/convenios finales y cantidades de monedas si se desea cambiar las iniciales.
- Iniciar correctamente el motor de Docker para construir y comprobar imágenes, o usar instalación Node/PostgreSQL normal.
- En una tarea posterior autorizada: HTTPS, dominio `civigo.online`, proveedor de alojamiento, persistencia de archivos y despliegue. Los pagos reales están fuera de esta demostración.

## 8. Bloqueos que requieren al propietario

Faltan proveedores y sus credenciales, una identidad para el administrador inicial y datos históricos reales. No se inventaron claves ni identidades. Docker requiere un motor operativo. El archivo de entorno del backend ya figuraba en el historial Git: retirarlo del seguimiento no borra versiones anteriores; revisar y rotar esas credenciales antes de publicar el repositorio.

## 9. Revisión al volver

Leer `docs/operacion-y-despliegue.md` para el arranque. El comando habitual `node scripts/dev.js` utiliza la configuración conservada de Supabase. `--local --demo` permite una demostración separada, con contraseña local elegida por el propietario mediante `DEMO_PASSWORD`.

Recorrer registro/perfil, mapa/rutas, reporte individual y comunitario, panel de agente y administrador, ranking/recompensas, negocios y Premium. Revisar especialmente que gravedad, puntos del tramo, credibilidad y monedas se entienden como valores distintos. Verificar los valores provisionales, el flujo de pruebas privadas y los plazos en un teléfono.

Las capturas de `docs/capturas/` muestran datos locales de prueba, sin atribuirlos a hechos reales. No se realizó commit, push, publicación ni despliegue; los cambios están disponibles para revisión en el repositorio.

El logo se puede revisar en `docs/capturas/logo-escritorio.jpg` y `logo-movil.jpg`. La vista compilada de revisión sirve en `http://127.0.0.1:3000` con la base local de demostración; el comando normal sigue usando Supabase según la configuración conservada.

La identidad azul/celeste actual puede revisarse en `docs/capturas/identidad-azul-escritorio.png`, `identidad-azul-movil.png` e `identidad-azul-mapa.png`. Revisar especialmente botones, lectura de textos, navegación de teclado y distinción entre el azul del recorrido y los colores de riesgo de las calles.

Los 15 iconos suministrados en `frontend/iconos` ya aparecen en el mapa, listas, detalle, formulario y paneles de revisión/catálogo. Los originales se conservan; las versiones servidas por Next pesan aproximadamente 2–3 KB. Los siete tipos sin PNG mantienen un símbolo neutro. Capturas `docs/capturas/iconos-incidentes-escritorio.png`, `iconos-incidentes-movil.png` e `iconos-catalogo.png`; 20/20 pruebas frontend, lint, tipos y build aprobados, además de revisión en navegador y HTTP 200 para los 15 iconos.

El alojamiento público confirmado es Vercel + Railway + Supabase, con civigo.online en GoDaddy. Su configuración en proveedores sigue pendiente; los archivos Docker son auxiliares y no cambian ese acuerdo.
