# Operación de CiviGo

El despliegue público acordado usa **Vercel para el frontend, Railway para la API Node.js, Supabase para PostgreSQL y GoDaddy para civigo.online**. Su preparación y configuración final en los proveedores siguen pendientes. Los ejemplos de Docker/Compose de este documento se conservan como herramientas auxiliares; el stack acordado puede ejecutarse sin instalar Docker en el equipo del propietario. No se ha desplegado ni modificado infraestructura externa.

## Ejecutar en desarrollo

Se necesita Node.js 24 y las dependencias instaladas en `backend` y `frontend`. El código conserva Express, Prisma y Next.js. La base principal sigue siendo PostgreSQL de Supabase.

```powershell
cd backend
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
cd ../frontend
npm ci
cd ..
node scripts/dev.js
```

El lanzador inicia la API en `http://127.0.0.1:4000` y la web en `http://localhost:3000`. No despliega ni modifica los archivos de entorno. Next.js envía `/api` al backend y mantiene la sesión mediante cookie HttpOnly.

En ejecución nativa la API usa `API_HOST=127.0.0.1` por defecto, y el lanzador fija esa dirección: solo acepta conexiones del propio equipo, adecuadas para Next.js o un proxy local. Dentro del contenedor se establece `API_HOST=0.0.0.0` para que el frontend y el proxy puedan alcanzar la API mediante la red de Docker. Compose sigue publicando el puerto del host únicamente en `127.0.0.1:4000`; esa escucha interna no abre el puerto a Internet.

`backend/.env` contiene `DATABASE_URL`. El archivo de frontend existente es `frontend/.env`; Next también acepta `frontend/.env.local`, recomendado para nuevas configuraciones locales. Contiene el token público de Mapbox y, opcionalmente, `BACKEND_URL`. El lanzador respeta ambos archivos, con prioridad para `.env.local`, sin modificarlos. Los ejemplos se incluyen sin claves. Nunca colocar claves de Supabase, correo o IA en variables `NEXT_PUBLIC_*`.

## Base local y demostración

`node scripts/dev.js --local` prepara una base PostgreSQL compatible mediante PGlite bajo `backend/.local`, sin sobrescribir la configuración de Supabase. Es una alternativa de desarrollo; su servidor de conexiones es experimental. Para concurrencia y verificaciones reproducibles se recomienda PostgreSQL normal, como el servicio de las verificaciones de GitHub.

`LOCAL_DB_PORT` permite elegir otro puerto local válido; `LOCAL_DB_DIR` permite separar los datos de cada demostración o prueba. El lanzador utiliza el mismo puerto que el servidor local.

Antes de abrir conexiones Prisma, el lanzador espera el puerto local y genera el cliente. Esto evita que Windows conserve una DLL cargada mientras se intenta reemplazarla. Las bases nuevas se preparan con `prisma migrate deploy`. Las bases locales antiguas, creadas mediante `db push`, se comparan con el esquema actual y se registran como baseline solo después de comprobar su equivalencia. No se aceptan pérdidas de datos ni se fuerza un reset. Una baseline interrumpida conserva un marcador para reanudar los registros pendientes; si el esquema cambió entretanto, el proceso se detiene y conserva la base. Elegir un `LOCAL_DB_DIR` nuevo permite iniciar una demostración separada sin borrar la anterior.

El ayudante incluye un adaptador compatible con `pglite-socket` 0.2.11 que corrige bloqueos de cola y desconexiones del protocolo. Conserva una sola conexión; detener la API antes de conectar Prisma CLI u otra herramienta a esa base. No aumentar sus conexiones para simular un PostgreSQL de producción.

El modo local permite códigos de verificación de demostración, claramente identificados. Para preparar tres cuentas locales (`admin@demo.civigo.local`, `agente@demo.civigo.local`, `ciudadano@demo.civigo.local`) elegir una contraseña local mediante `DEMO_PASSWORD` y ejecutar el lanzador con `--local --demo`. No se imprime la contraseña ni se sustituyen credenciales de cuentas existentes. Sin una contraseña explícita, la semilla genera una que no se imprime.

En producción `DEMO_VERIFICATION=true` provoca un error de inicio. Premium, publicidad y canjes son demostraciones y no realizan cobros.

## Validaciones

```powershell
cd backend
npm run check
npm test
$env:TEST_DATABASE_URL='postgresql://postgres:clave-local@127.0.0.1:5432/civigo_test'
npm test
cd ../frontend
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Sin `TEST_DATABASE_URL`, se ejecutan pruebas de dominio y se omiten las de integración. Las integraciones crean datos identificados como pruebas y limpian solo sus propios registros. Las pruebas con base remota requieren habilitación explícita y una base de prueba.

## Primer administrador

El registro público crea únicamente usuarios ciudadanos. La promoción a agente y la asignación de distrito, permisos y Premium se hacen desde un administrador. Para el primero, registrar una cuenta propia, definir `ADMIN_EMAIL` con ese correo y ejecutar `node scripts/bootstrap-admin.js` en `backend`. El script funciona solo cuando no hay administrador activo, conserva las credenciales y usa un bloqueo transaccional para que dos ejecuciones concurrentes no preparen dos administradores iniciales. No existe una contraseña administrativa incorporada al código. Las identidades, documentos y pruebas privadas no se exponen en el mapa o ranking.

## Servicios pendientes de configuración

- SMS/WhatsApp: adaptador Twilio Verify, variables `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`.
- Correo: adaptador Resend, `RESEND_API_KEY` y `EMAIL_FROM`.
- IA: `AI_API_KEY`, `AI_MODEL` y, opcionalmente, `AI_BASE_URL`. Una emergencia sin evaluación aparece «por evaluar»; otros reportes esperan revisión. El asistente identifica su guía local cuando no hay IA.
- Mapbox: token público limitado a los dominios permitidos para el mapa base. Las rutas se calculan con calles de OpenStreetMap; no requieren un servicio de Directions ni prometen tráfico en vivo.
- DATACRIM: todavía no hay una fuente concreta entregada. Los administradores pueden revisar e importar CSV/JSON de hechos históricos con coordenadas verificables.

## Calles, cobertura y archivos

`backend/data/ica-roads.json` contiene datos reales de OpenStreetMap descargados el 1 de octubre de 2026: vías, límite provincial y límites de los catorce distritos. Se puede actualizar con `npm run roads:import` y reiniciar la API. El mapa acredita a OpenStreetMap; la licencia es ODbL 1.0. Revisar datos, accesos y giros antes de usar la navegación en un piloto: las duraciones son estimaciones, no tráfico en vivo ni instrucciones giro a giro.

Los archivos subidos se guardan en `UPLOAD_DIR`. El backend valida firma, tipo, tamaño y duración de videos; los documentos y pruebas privadas se entregan mediante endpoints con permisos. No usar un disco efímero al alojarlo: se necesita un volumen persistente o sustituir el adaptador por almacenamiento privado persistente.

La API ejecuta los recordatorios y plazos cada cinco minutos si `ENABLE_JOBS` está activo. Mantener una única instancia ejecutora o usar `ENABLE_JOBS=false` y programar `npm run jobs:run` en una única tarea. El panel permite ejecutar la revisión de plazos manualmente. El recordatorio por correo requiere proveedor configurado.

## Preparación para producción

Se prepararon Dockerfiles, `compose.yaml` y verificaciones automáticas. No se construyeron o publicaron imágenes ni se realizó despliegue. Se validó la configuración de Compose; el motor de Docker no estaba disponible en este equipo. La CI incluye construcción de ambas imágenes, arranque de la API y la web, acceso al volumen de archivos y comprobación de `/api/ready` y `/api/catalog` a través de la web. Esos pasos deberán ejecutarse en un equipo con Docker o en GitHub antes del despliegue.

Antes del despliegue solicitado por el propietario: configurar HTTPS y el dominio, `FRONTEND_URL`, proxy de API, token Mapbox público restringido, proveedores, administrador inicial y persistencia de archivos. `GET /api/health` comprueba el proceso y servicios configurados; `GET /api/ready` comprueba la conexión a la base. Ejecutar migraciones y semilla de catálogo como preparación separada, no en cada réplica.

La URL de backend usada en las reescrituras de Next se fija al construir la web. Si cambia el dominio de la API, reconstruir con el `BACKEND_URL` correspondiente. El contenedor preparado usa `http://backend:4000` por la red interna de Compose. La demostración de Premium no incluye suscripciones, facturación ni entregas reales.

### Procedimiento preparado para el despliegue futuro

Estos pasos son instrucciones para cuando se autorice el despliegue; no se ejecutaron sobre infraestructura externa.

1. Configurar un archivo privado de backend, por ejemplo `backend/.env.production`, con la conexión de PostgreSQL/Supabase, proveedores, `TRUST_PROXY` según el proxy real y las demás variables necesarias. Los archivos `.env.*` privados quedan excluidos de Git y del contexto Docker.
2. Definir `BACKEND_ENV_FILE=backend/.env.production`, `FRONTEND_URL=https://civigo.online` y el token público `NEXT_PUBLIC_MAPBOX_TOKEN` en el entorno de Compose o en un `.env` privado de la raíz. El token del mapa se incorpora al construir la web. No usar claves privadas como variables públicas de frontend.
3. Validar la configuración con `docker compose config --quiet` y construir mediante `docker compose build`. La API usa PostgreSQL existente; Compose no crea ni borra una base.
4. Preparar el esquema y catálogo una sola vez mediante `docker compose run --rm backend npm run db:migrate` y `docker compose run --rm backend npm run db:seed`. Hacer una copia de seguridad y comprobar que la conexión corresponde al entorno previsto antes de modificar una base que ya contenga datos.
5. Arrancar con `docker compose up -d` y comprobar `docker compose ps`, `http://127.0.0.1:4000/api/ready` y `http://127.0.0.1:3000`. Los puertos están publicados únicamente en loopback; el volumen `archivos` conserva adjuntos al recrear contenedores. No usar `docker compose down -v` si deben conservarse archivos.
6. Configurar DNS en GoDaddy para `civigo.online` y `www`, obtener certificados HTTPS para ambos nombres y adaptar [deploy/nginx.conf.example](../deploy/nginx.conf.example). Validar con `nginx -t` antes de habilitarlo. El ejemplo redirige `www` al dominio principal y conserva `/api` al enviarlo directamente al backend.
7. Registrar la cuenta del propietario y ejecutar `docker compose run --rm -e ADMIN_EMAIL backend npm run db:bootstrap`, habiendo definido `ADMIN_EMAIL` en el entorno. Comprobar acceso de administrador, registro, rutas, revisión de reportes, subida de pruebas y recepción de códigos con los proveedores reales.

### Proxy y límites de solicitudes

`TRUST_PROXY` queda vacío por defecto. Acepta una lista de IP/CIDR de proxies conocidos o nombres de red admitidos por Express; no habilitar confianza global ni un número de saltos. Debe configurarse solo si un proxy controlado sobrescribe `X-Forwarded-For` y el acceso directo a la API permanece protegido.

Next.js puede conservar `X-Forwarded-For` proporcionado por el cliente al reescribir `/api`; por eso el lanzador no habilita confianza automáticamente. El ejemplo de Nginx sobrescribe la cabecera y enruta `/api` directamente al backend. Para procesos nativos detrás del Nginx local, el interlocutor de la API suele ser loopback. En Docker puede ser la IP del gateway de su red: comprobarla y confiar exclusivamente en esa dirección o red controlada, sin asumir que siempre será `127.0.0.1`. Configurar `TRUST_PROXY` en el archivo privado del backend y recrear la API cuando cambie. Los límites adicionales por cuenta y sesión siguen siendo necesarios.

Referencias: [salida standalone de Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [proxy HTTP de Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header) y [variables de Compose](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
