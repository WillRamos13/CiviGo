# Integraciones de CiviGo

El stack del proyecto es **frontend Next.js en Vercel, API Express en Railway, PostgreSQL y archivos privados en Supabase, y dominio civigo.online administrado en GoDaddy**. Las integraciones están preparadas en el código; configurar variables no contrata un proveedor, crea un bucket ni demuestra una conexión o entrega real. Esta actualización no publica el proyecto ni modifica infraestructura externa.

## Servicios y ubicación de su configuración

| Servicio | Uso en CiviGo | Dónde configurar | Qué hace falta |
|---|---|---|---|
| Supabase PostgreSQL | Usuarios, sesiones, catálogo, reportes, incidentes y reglas mediante Prisma. | Railway: `DATABASE_URL`. | Conexión PostgreSQL válida y migraciones aplicadas. |
| Supabase Storage | Fotos, videos, pruebas e identidad con descargas autorizadas por la API. | Railway: `STORAGE_PROVIDER`, `SUPABASE_URL`, clave privada y nombre del bucket. | Bucket privado existente y credencial privada del backend. |
| OpenAI Responses | Chatbot y evaluación inicial del texto de reportes. | Railway: `OPENAI_API_KEY`, opcionalmente `AI_MODEL` y `AI_TIMEOUT_MS`. | Cuenta de API, clave, acceso al modelo y facturación/cuota disponibles. |
| Twilio Verify | Código de verificación por SMS o WhatsApp. | Railway: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. | Cuenta y servicio Verify; configurar los canales en Twilio. WhatsApp necesita remitente propio. |
| Resend | Verificación del correo y recordatorio de pruebas. | Railway: `RESEND_API_KEY`, `EMAIL_FROM`. | Cuenta, dominio remitente verificado y registros DNS correspondientes. |
| Mapbox | Mapa base y representación visual de calles, reportes y recorridos. | Vercel: `NEXT_PUBLIC_MAPBOX_TOKEN`. | Token público `pk.` con permisos del mapa y restricciones de URL compatibles. |
| OpenStreetMap | Red vial y búsquedas de direcciones locales; cálculo de recorridos en el backend. | Archivo `backend/data/ica-roads.json`. | Datos vigentes de cobertura. No necesita clave de Directions ni llamadas a una API de tráfico en vivo. |
| Geolocalización del navegador | Posición y seguimiento durante el recorrido. | Permiso del usuario en su navegador. | HTTPS en el sitio público y permiso de ubicación. No usa una clave de API. |
| GoDaddy / Vercel Domains | DNS, dominio público y HTTPS del frontend. | DNS en GoDaddy; dominio del proyecto en Vercel. | Mantener los registros exactos que indique Vercel y los orígenes del backend actualizados. |
| Premium, anuncios y canjes | Demostración de funciones, impresiones y economía interna. | Panel administrativo y reglas del proyecto. | No hay pasarela de pago, suscripción cobrable ni API de facturación integrada. |
| Antecedentes históricos | Importación administrativa CSV/JSON con ubicación y fecha del hecho. | Panel de Antecedentes. | Aún no hay una API externa de DATACRIM u otra fuente contratada. |

La autenticación actual sigue siendo la de CiviGo: contraseña protegida y sesión en cookie HttpOnly gestionada por Express/Prisma. Usar Supabase para datos y archivos no convierte este flujo en Supabase Auth.

## Variables de Vercel

En el proyecto del frontend, abrir **Settings → Environment Variables**. Seleccionar Production y también Preview si se utilizarán despliegues de previsualización.

| Nombre | Valor o regla |
|---|---|
| `BACKEND_URL` | `https://civigo-production.up.railway.app`, o el origen HTTPS público real del servicio. Sin `/api`, rutas, credenciales ni parámetros. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Token público de Mapbox del propietario. Nunca un token secreto `sk.`. |
| `NEXT_PUBLIC_API_URL` | Normalmente no se necesita: la web usa `/api` por defecto. Si ya existe, dejar `/api` para conservar esta arquitectura. |

La raíz del proyecto debe ser `frontend`; Vercel detecta Next.js y ejecuta `npm run build`. La reescritura definida en `frontend/next.config.ts` envía `/api/:path*` a `BACKEND_URL/api/:path*`. La URL del backend y el token público se incorporan al construir la web: aplicar cambios exige un nuevo despliegue del frontend. [Reescrituras externas de Vercel](https://vercel.com/docs/routing/rewrites).

Las claves de OpenAI, Twilio, Resend, PostgreSQL y Supabase Storage pertenecen a Railway. Nunca deben ser `NEXT_PUBLIC_*`, aparecer en Git ni pegarse en capturas o mensajes.

## Variables de Railway

En el servicio del backend, abrir **Variables** y agregar los nombres y valores por separado, sin copiar comillas de ejemplos de `.env`.

| Nombre | Valor o regla |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL de Supabase compatible con Prisma. La clave de Storage no sustituye esta URL. |
| `NODE_ENV` | `production`. |
| `FRONTEND_URL` | `https://civigo.online,https://www.civigo.online,https://civigo-rho.vercel.app`. Agregar solo los orígenes de previsualización autorizados que se necesiten. Sin rutas ni barra final. |
| `COOKIE_SAME_SITE` | `lax` para las solicitudes `/api` del mismo origen mediante Vercel. |
| `OPENAI_API_KEY` | Clave privada del proyecto de OpenAI. |
| `AI_MODEL` | Opcional; valor inicial del adaptador: `gpt-4.1-mini`. |
| `AI_TIMEOUT_MS` | Opcional; `15000` por defecto. El adaptador admite entre 1000 y 30000 milisegundos. |
| `TWILIO_ACCOUNT_SID` | Account SID de la cuenta; formato `AC` seguido de 32 caracteres hexadecimales. |
| `TWILIO_AUTH_TOKEN` | Auth Token privado de esa cuenta. |
| `TWILIO_VERIFY_SERVICE_SID` | SID del servicio Verify; formato `VA` seguido de 32 caracteres hexadecimales. |
| `RESEND_API_KEY` | Clave privada de Resend con permiso de envío. |
| `EMAIL_FROM` | Remitente del dominio verificado, por ejemplo `CiviGo <notificaciones@correo.civigo.online>`. Es una dirección propuesta, no una cuenta creada por el código. |
| `STORAGE_PROVIDER` | `supabase` para archivos en la nube; `local` es el valor por defecto y necesita persistencia propia. |
| `SUPABASE_URL` | URL HTTPS raíz del proyecto Supabase, sin `/storage/v1`, consultas ni credenciales. |
| `SUPABASE_SECRET_KEY` | Clave secreta del backend de Supabase. Alternativa compatible: `SUPABASE_SERVICE_ROLE_KEY`. No usar una clave pública/anon. |
| `SUPABASE_STORAGE_BUCKET` | Nombre del bucket privado existente; por defecto `civigo-attachments`. |
| `UPLOAD_DIR` | Opcional. Directorio temporal de recepción; en modo local debe estar en un volumen persistente. |
| `ENABLE_JOBS` | Dejar sin definir o usar `true` en una única instancia que procese plazos. `false` desactiva ese trabajo periódico. |
| `DEMO_VERIFICATION` | Dejar sin definir o `false`. `true` se rechaza en producción. |

`AI_API_KEY` sigue siendo un alias de compatibilidad; se prefiere `OPENAI_API_KEY`, que tiene prioridad. `AI_BASE_URL` no es necesario: el adaptador usa el endpoint oficial Responses. Si existe con el antiguo endpoint oficial Chat Completions, se acepta por compatibilidad y se usa Responses; otros hosts se rechazan para evitar enviar la clave a un destino incorrecto.

El servicio Railway debe usar la raíz `/backend`, compilación `npm run db:generate`, **Pre-deploy Command** `npm run db:migrate && npm run db:seed`, **Start Command** `npm start` y healthcheck `/api/ready`. `node src/server.js` en Start también es válido. El predeploy debe terminar; no colocar el servidor ni `npm start` dentro de ese campo. `db:generate` crea el cliente Prisma; no crea tablas ni aplica migraciones. [Pre-deploy de Railway](https://docs.railway.com/deployments/pre-deploy-command).

Conservar el puerto asignado por Railway y su dominio público HTTPS. El código escucha en `0.0.0.0` cuando se ejecuta en producción/Railway. Al cambiar variables del backend, aplicar el nuevo despliegue del servicio; esto no exige reconstruir el frontend si su `BACKEND_URL` sigue igual.

## Activar OpenAI

1. Crear o usar un proyecto en la plataforma de OpenAI y configurar su facturación y acceso al modelo elegido. Una suscripción de ChatGPT no es una credencial de API para este backend.
2. Crear una clave privada del proyecto y guardarla como `OPENAI_API_KEY` en Railway. Puede dejarse el modelo inicial `gpt-4.1-mini`.
3. Tras aplicar el cambio, comprobar la configuración y realizar una conversación de prueba desde CiviGo. Si la clave o cuota falla, el chatbot identifica su respuesta como **guía de CiviGo**, sin simular una respuesta de IA.

El backend utiliza `POST https://api.openai.com/v1/responses`, salida estructurada para evaluar reportes y un historial breve para el chatbot. Cada petición admite hasta diez mensajes previos; el frontend conserva turnos en memoria, sin guardarlos en localStorage ni crear conversaciones alojadas. El contexto del chatbot incluye una muestra de incidentes públicos y reglas; no incluye autores, sesiones, documentos o pruebas privadas. El texto escrito por el usuario sí se envía al proveedor. La evaluación inicial envía tipo, descripción y fechas; actualmente no analiza imágenes o videos adjuntos.

Las solicitudes incluyen `store: false`, que desactiva el almacenamiento de las respuestas como estado de aplicación. **No equivale a Zero Data Retention ni elimina por sí solo los registros de seguridad del proveedor**; esos controles requieren condiciones y aprobación adicionales de OpenAI. Revisar el aviso de privacidad antes de abrir la participación pública. [Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses), [controles de datos de OpenAI](https://developers.openai.com/api/docs/guides/your-data).

Un timeout, límite o respuesta inválida devuelve la evaluación a los flujos existentes de revisión humana. Las emergencias acordadas pueden publicarse por evaluar; los demás tipos esperan validación. La evaluación de un agente prevalece. El chatbot explica funciones y datos disponibles: no publica reportes, contacta agentes, cambia cuentas ni garantiza seguridad de las rutas.

## Activar SMS y WhatsApp con Twilio

1. Crear la cuenta y un **Verify Service**. Guardar sus tres variables privadas en Railway.
2. Permitir SMS al destino Perú en **Verify → Settings → Geo permissions** y revisar las protecciones de fraude del servicio. En cuentas de prueba, Twilio exige verificar previamente los números destinatarios habilitados para pruebas. [Verify](https://www.twilio.com/docs/verify/api/verification), [Geo Permissions](https://www.twilio.com/docs/verify/preventing-toll-fraud/verify-geo-permissions).
3. Para WhatsApp, configurar un remitente propio asociado a una WhatsApp Business Account y habilitarlo para Verify. Las tres variables no completan esa alta por sí solas. No hay cambio automático de WhatsApp a SMS en CiviGo. [Verify WhatsApp](https://www.twilio.com/docs/verify/whatsapp).
4. Solicitar un código desde el perfil y confirmar que llega al número previsto. Solo la aprobación de Twilio marca el teléfono como verificado.

El código limita solicitudes a cinco por hora por usuario y tipo, espera un minuto entre solicitudes y permite cinco intentos por código. No reintenta un envío automáticamente tras un timeout: podría haber sido enviado ya. Los códigos vencidos, los límites y los canales sin habilitar se distinguen de un fallo general del proveedor. Un teléfono ya verificado no vuelve a generar un envío al repetir la solicitud.

## Activar correo con Resend

1. Crear la cuenta y añadir un dominio remitente. Puede usarse el subdominio `correo.civigo.online` para separar correo transaccional de la web.
2. En GoDaddy, añadir exactamente los registros DNS que muestre Resend y esperar su verificación. No sustituir los registros A/CNAME usados por la web ni registros de correo existentes sin evaluar su función. [Dominios verificados de Resend](https://resend.com/docs/dashboard/domains/introduction).
3. Crear la clave de envío y configurar `RESEND_API_KEY` y `EMAIL_FROM` en Railway.
4. Solicitar verificación de correo desde el perfil, comprobar recepción y usar el código dentro de diez minutos. Comprobar también los recordatorios de pruebas con datos de prueba.

Un correo se considera aceptado por el proveedor solo si Resend devuelve un identificador válido; la entrega a la bandeja debe verificarse aparte. Los envíos llevan claves idempotentes vinculadas a la verificación o al reporte, conservadas por Resend durante 24 horas; no sustituyen el marcado persistente de los recordatorios en PostgreSQL. No hay reintentos automáticos en el adaptador. [Envío](https://resend.com/docs/api-reference/emails/send-email), [idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Activar archivos privados en Supabase Storage

1. En el proyecto Supabase, confirmar que existe el bucket elegido y que es **privado**. Si falta, el propietario debe crearlo previamente con el nombre que configurará; CiviGo no crea buckets ni cambia su privacidad automáticamente.
2. Ajustar las restricciones del bucket para los formatos permitidos y al menos 15 MiB por archivo. El límite del backend sigue siendo 15 MiB, tres adjuntos por aporte y videos de hasta treinta segundos. Los PDF son únicamente privados.
3. Configurar `STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y, si se cambia el nombre inicial, `SUPABASE_STORAGE_BUCKET` en Railway. La alternativa legacy `SUPABASE_SERVICE_ROLE_KEY` también funciona. Estas claves dan acceso privilegiado y nunca llegan al frontend. [Buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets), [control de acceso](https://supabase.com/docs/guides/storage/security/access-control).
4. Comprobar una subida y descarga como propietario, como agente del distrito con permiso de evidencia y como usuario sin permiso. Los archivos públicos también permanecen en el bucket privado: el backend decide si el reporte está publicado antes de entregarlos.

La API recibe temporalmente el archivo, valida firma/tamaño/duración y lo guarda bajo una ruta opaca por usuario. Los registros nuevos usan Supabase; los registros anteriores en disco conservan su ruta y necesitan que ese disco siga disponible. Cambiar el proveedor no migra archivos antiguos automáticamente. En caso de fallo remoto no se sustituyen archivos por un almacenamiento local efímero silencioso.

**Pendiente verificar el límite por la ruta pública real:** probar una imagen/video válido mayor de 4,5 MB y otro cercano a 15 MiB desde `https://civigo.online`, pasando por la reescritura de Vercel, además de un archivo que supere 15 MiB y deba rechazarse. Una reescritura a Railway no es una función de subida de Vercel; no se debe trasladar automáticamente el límite de Vercel Functions a esa ruta ni afirmar que admite 15 MiB sin probarla. Confirmar respuesta, persistencia y permisos de descarga en el entorno contratado.

## Diagnóstico y comprobaciones

Desde `backend`:

```powershell
npm run integrations:check
npm run integrations:check -- --strict
```

El primer comando informa los requisitos sin hacer llamadas externas ni imprimir valores privados. `--strict` devuelve un código de salida distinto de cero si alguna configuración de proveedor está pendiente o es inválida. El modo local de archivos puede aparecer configurado aunque no se haya comprobado su persistencia en Railway.

En **Administración → Integraciones**, solo los administradores pueden consultar el mismo diagnóstico mediante `/api/admin/integrations`. Muestra nombres de variables y estado de presencia/formato; no prueba conexión, saldo, permiso real, WhatsApp habilitado, remitente verificado ni existencia/privacidad del bucket. `GET /api/health` confirma el proceso; `GET /api/ready` comprueba PostgreSQL, no los proveedores de pago.

Antes de considerar activados los servicios, comprobar en el entorno previsto:

- Registro, sesión, rutas y visualización del mapa desde el dominio final.
- Chatbot con continuidad de conversación, modo IA real y fallback visible si el proveedor falla.
- Evaluación de un reporte de prueba y prioridad posterior de la revisión humana.
- SMS y WhatsApp recibidos, códigos erróneos/vencidos y límites sin reenvíos inesperados.
- Correo recibido y un código que verifique únicamente la dirección vigente.
- Adjuntos persistentes, límites de video/tamaño y permisos sobre pruebas privadas e identidad.
- Reinicio del backend sin pérdida de datos o archivos, y recordatorios/plazos procesados por una única instancia.

Las pruebas automatizadas con mocks y servidores locales comprueban contratos y flujos; no acreditan envíos, cobros o disponibilidad real de las cuentas del propietario. En local se usan `backend/.env` y `frontend/.env.local`, ambos privados. No hay `backend/.env.example` en esta versión: los nombres y valores no secretos se documentan aquí.
