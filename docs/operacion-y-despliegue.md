# Operación de CiviGo

El despliegue público acordado usa **Vercel para el frontend, Railway para la API Node.js, Supabase para PostgreSQL y archivos privados, y GoDaddy para civigo.online**. La [guía de integraciones](integraciones.md) contiene las variables por plataforma y las altas pendientes de los proveedores. El stack puede ejecutarse sin instalar Docker en el equipo del propietario; los ejemplos Docker/Compose son auxiliares opcionales. Esta actualización del código no despliega ni modifica infraestructura externa.

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

`backend/.env` contiene `DATABASE_URL` y las variables privadas del servidor para desarrollo. No existe `backend/.env.example` en esta versión: usar la [tabla de configuración](integraciones.md). El archivo de frontend existente es `frontend/.env`; Next también acepta `frontend/.env.local`, recomendado para nuevas configuraciones locales. Contiene el token público de Mapbox y, opcionalmente, `BACKEND_URL`. El lanzador respeta ambos archivos, con prioridad para `.env.local`, sin modificarlos. No copiar estos archivos a Git ni poner claves privadas de Supabase, correo o IA en variables `NEXT_PUBLIC_*`.

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
npm run integrations:check
$env:TEST_DATABASE_URL='postgresql://postgres:clave-local@127.0.0.1:5432/civigo_test'
npm test
cd ../frontend
npm run lint
npm run typecheck
npm test
npm run build
```

Sin `TEST_DATABASE_URL`, se ejecutan pruebas de dominio y se omiten las de integración. Las integraciones crean datos identificados como pruebas y limpian solo sus propios registros. Las pruebas con base remota requieren habilitación explícita y una base de prueba.

## Primer administrador

El registro público crea únicamente usuarios ciudadanos. La promoción a agente y la asignación de distrito, permisos y Premium se hacen desde un administrador. Para el primero, registrar una cuenta propia, definir `ADMIN_EMAIL` con ese correo y ejecutar `node scripts/bootstrap-admin.js` en `backend`. El script funciona solo cuando no hay administrador activo, conserva las credenciales y usa un bloqueo transaccional para que dos ejecuciones concurrentes no preparen dos administradores iniciales. No existe una contraseña administrativa incorporada al código. Las identidades, documentos y pruebas privadas no se exponen en el mapa o ranking.

## Servicios pendientes de configuración

- SMS/WhatsApp: adaptador Twilio Verify, variables `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. La cuenta/servicio se configura en Twilio; WhatsApp requiere remitente propio asociado a WABA, además de las variables.
- Correo: adaptador Resend, `RESEND_API_KEY` y `EMAIL_FROM`, con dominio o subdominio remitente verificado por DNS.
- IA: `OPENAI_API_KEY` (alias compatible `AI_API_KEY`), `AI_MODEL` (`gpt-4.1-mini` inicial) y `AI_TIMEOUT_MS`. Se usa OpenAI Responses con `store: false`; esto no acredita Zero Data Retention. Una emergencia sin evaluación aparece «por evaluar»; otros reportes esperan revisión. El asistente distingue una respuesta de IA de la guía local cuando falta o falla el proveedor.
- Archivos: `STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (o la alternativa `SUPABASE_SERVICE_ROLE_KEY`) y un bucket privado existente indicado en `SUPABASE_STORAGE_BUCKET`.
- Mapbox: token público limitado a los dominios permitidos para el mapa base. Las rutas se calculan con calles de OpenStreetMap; no requieren un servicio de Directions ni prometen tráfico en vivo.
- DATACRIM: todavía no hay una fuente concreta entregada. Los administradores pueden revisar e importar CSV/JSON de hechos históricos con coordenadas verificables.

Consultar **Administración → Integraciones** o ejecutar `npm run integrations:check` en backend para revisar presencia/formato de configuración sin exponer valores. No prueba conexión, cuota/saldo, habilitación de canales, remitente ni bucket. `--strict` devuelve salida de error si algún proveedor está pendiente o es inválido. Las pruebas simuladas no acreditan SMS, correos o llamadas de IA reales.

## Calles, cobertura y archivos

`backend/data/ica-roads.json` contiene datos reales de OpenStreetMap descargados el 1 de octubre de 2026: vías, límite provincial y límites de los catorce distritos. Se puede actualizar con `npm run roads:import` y reiniciar la API. El mapa acredita a OpenStreetMap; la licencia es ODbL 1.0. Revisar datos, accesos y giros antes de usar la navegación en un piloto: las duraciones son estimaciones, no tráfico en vivo ni instrucciones giro a giro.

Con `STORAGE_PROVIDER=supabase`, los archivos se reciben temporalmente en `UPLOAD_DIR`, se validan y se conservan en el bucket privado configurado. El backend verifica privacidad del bucket y autoriza cada descarga, incluso para adjuntos públicos. Las credenciales privilegiadas quedan exclusivamente en Railway. Si se mantiene `STORAGE_PROVIDER=local`, `UPLOAD_DIR` necesita un volumen persistente; no depender del disco efímero al redeploy. Cambiar a Supabase no migra los archivos antiguos: conservar su disco o preparar una migración específica.

Máximo tres adjuntos por aporte y 15 MiB por archivo; video de hasta treinta segundos con duración verificable. Debe probarse una subida real cerca de ese tamaño desde el dominio público pasando por Vercel y Railway. No asumir automáticamente que el límite de Vercel Functions se aplica a una reescritura externa, ni afirmar compatibilidad con 15 MiB sin esa comprobación.

La API ejecuta los recordatorios y plazos cada cinco minutos si `ENABLE_JOBS` está activo. Mantener una única instancia ejecutora o usar `ENABLE_JOBS=false` y programar `npm run jobs:run` en una única tarea. El panel permite ejecutar la revisión de plazos manualmente. El recordatorio por correo requiere proveedor configurado.

## Preparación para producción

Las variables del entorno público se administran en Railway y Vercel, no editando un `.env` del repositorio. Conservar las credenciales existentes y agregar las que requieren los servicios que se vayan a habilitar.

Antes del despliegue solicitado por el propietario: configurar HTTPS y el dominio, `FRONTEND_URL`, proxy de API, token Mapbox público restringido, proveedores, administrador inicial y persistencia de archivos. `GET /api/health` comprueba el proceso y servicios configurados; `GET /api/ready` comprueba la conexión a la base. Ejecutar migraciones y semilla de catálogo como preparación separada, no en cada réplica.

La URL de backend usada en las reescrituras de Next se fija al construir la web. Si cambia el dominio de la API o el token público Mapbox, reconstruir el frontend en Vercel. La demostración de Premium no incluye suscripciones, facturación ni entregas reales.

### Procedimiento Vercel + Railway + Supabase

Estos pasos corresponden al stack público acordado. Son instrucciones para el propietario, no acciones ejecutadas por esta actualización sobre infraestructura externa.

1. En Supabase, obtener la conexión PostgreSQL compatible con Prisma y comprobar que corresponde a la base prevista. Para Storage, preparar previamente un bucket privado y su clave de backend; el código no crea ni publica el bucket. Ver [configuración de Prisma en Supabase](https://supabase.com/docs/guides/database/prisma) y [la guía de integraciones](integraciones.md).
2. En Railway, conectar el repositorio y elegir raíz `/backend`. Configurar build `npm run db:generate`, **Pre-deploy Command** `npm run db:migrate && npm run db:seed`, **Start Command** `npm start` (también es válido `node src/server.js`) y healthcheck `/api/ready`. Comprobar que los valores coincidan con `backend/railway.json` si está aplicado a ese servicio. El servidor no va en predeploy, y generar Prisma no aplica migraciones. [Pre-deploy de Railway](https://docs.railway.com/deployments/pre-deploy-command).
3. En Variables de Railway, establecer `DATABASE_URL`, `NODE_ENV=production`, `FRONTEND_URL=https://civigo.online,https://www.civigo.online,https://civigo-rho.vercel.app` y las variables de proveedores que se habiliten. Mantener `DEMO_VERIFICATION` desactivado. Obtener el dominio público HTTPS del backend y confirmar `/api/ready` después de aplicar la configuración.
4. En Vercel, conectar el mismo repositorio y elegir raíz `frontend` con Next.js y build `npm run build`. Configurar `BACKEND_URL=https://civigo-production.up.railway.app` o el origen real de Railway, sin `/api`, y `NEXT_PUBLIC_MAPBOX_TOKEN` con el token público del propietario. Usar `/api` como URL del cliente por defecto; las claves privadas no van en Vercel ni en `NEXT_PUBLIC_*`. Aplicar un nuevo despliegue cuando cambien las variables de compilación.
5. En Vercel Domains, agregar `civigo.online` y, si se usará, `www.civigo.online`. Elegir el dominio principal y una redirección para el otro. En GoDaddy, editar los registros exactos A/CNAME que muestre Vercel, esperar validación DNS y HTTPS. Añadir los dominios a las restricciones del token Mapbox. Mantener `FRONTEND_URL` alineado con los orígenes autorizados; las previsualizaciones también requieren su origen específico si usarán la API. [Dominios en Vercel](https://vercel.com/docs/domains/working-with-domains/add-a-domain).
6. Para el primer administrador, registrar una cuenta propia y ejecutar `npm run db:bootstrap` en el entorno del backend con `ADMIN_EMAIL` definido. El script conserva credenciales y solo prepara el administrador inicial cuando no existe uno activo. No se incorpora una contraseña administrativa al repositorio.
7. Completar las altas de OpenAI, Twilio y Resend en sus paneles y aplicar las variables privadas a Railway siguiendo [Integraciones](integraciones.md). Comprobar registro, sesión, rutas, permisos administrativos, revisión, SMS/WhatsApp recibidos, correo y persistencia de archivos. Probar tanto archivos superiores a 4,5 MB como cercanos a 15 MiB por el dominio final, además de rechazos y permisos de descarga. La presencia de variables no acredita esas pruebas.

### Herramientas Docker opcionales

Los Dockerfiles, `compose.yaml` y [el ejemplo Nginx](../deploy/nginx.conf.example) se conservan para ejecutar/verificar el stack en un equipo que elija esa alternativa. No forman parte del procedimiento Vercel/Railway y no se han vuelto a construir o publicar imágenes como parte de esta integración.

Para esa alternativa, usar un archivo privado de backend mediante `BACKEND_ENV_FILE`, validar `docker compose config --quiet`, construir con `docker compose build` y preparar esquema/catálogo mediante `docker compose run --rm backend npm run db:migrate` y `docker compose run --rm backend npm run db:seed` antes de `docker compose up -d`. Compose usa PostgreSQL existente y el frontend alcanza `http://backend:4000` por su red interna; los puertos publicados del ejemplo quedan en loopback. Su volumen de archivos necesita conservarse: no usar `docker compose down -v` si contiene adjuntos necesarios. HTTPS y proxy externo requieren configuración propia en esa alternativa.

### Proxy y límites de solicitudes

`TRUST_PROXY` queda vacío por defecto. Acepta una lista de IP/CIDR de proxies conocidos o nombres de red admitidos por Express; no habilitar confianza global ni un número de saltos. Debe configurarse solo si un proxy controlado sobrescribe `X-Forwarded-For` y el acceso directo a la API permanece protegido.

Next.js puede conservar `X-Forwarded-For` proporcionado por el cliente al reescribir `/api`; por eso el lanzador no habilita confianza automáticamente. El ejemplo de Nginx sobrescribe la cabecera y enruta `/api` directamente al backend. Para procesos nativos detrás del Nginx local, el interlocutor de la API suele ser loopback. En Docker puede ser la IP del gateway de su red: comprobarla y confiar exclusivamente en esa dirección o red controlada, sin asumir que siempre será `127.0.0.1`. Configurar `TRUST_PROXY` en el archivo privado del backend y recrear la API cuando cambie. Los límites adicionales por cuenta y sesión siguen siendo necesarios.

Referencias: [salida standalone de Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [proxy HTTP de Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header) y [variables de Compose](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
