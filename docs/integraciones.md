# Integraciones de CiviGo

El stack del proyecto es **frontend Next.js en Vercel, API Express en Railway, PostgreSQL y archivos privados en Supabase, y dominio civigo.online administrado en GoDaddy**. Las integraciones están preparadas en el código; configurar variables no contrata un proveedor, crea un bucket ni demuestra una conexión o entrega real. Esta actualización no publica el proyecto ni modifica infraestructura externa.

## Servicios y ubicación de su configuración

| Servicio | Uso en CiviGo | Dónde configurar | Qué hace falta |
|---|---|---|---|
| Supabase PostgreSQL | Usuarios, sesiones, catálogo, reportes, incidentes y reglas mediante Prisma. | Railway: `DATABASE_URL`. | Conexión PostgreSQL válida y migraciones aplicadas. |
| Supabase Storage | Fotos, videos, pruebas e identidad con descargas autorizadas por la API. | Railway: `STORAGE_PROVIDER`, `SUPABASE_URL`, clave privada y nombre del bucket. | Bucket privado existente y credencial privada del backend. |
| OpenAI Responses | Chatbot y evaluación inicial del texto de reportes, con modelos separados. | Railway: `OPENAI_API_KEY`, opcionalmente `AI_REPORT_MODEL`, `AI_CHAT_MODEL` y `AI_TIMEOUT_MS`. | Cuenta de API, clave, acceso a los modelos y facturación/cuota disponibles. |
| Google / Firebase Authentication | Verificar el correo con una cuenta Google coincidente; conserva las sesiones de CiviGo. | Railway: `FIREBASE_PROJECT_ID`. Vercel: las cuatro variables `NEXT_PUBLIC_FIREBASE_*`. | Habilitar Google y los dominios autorizados. [Guía paso a paso](verificacion-contactos.md). |
| Resend | Recordatorios de pruebas; no verifica cuentas. | Railway: `RESEND_API_KEY`, `EMAIL_FROM`. | Cuenta, dominio remitente verificado y registros DNS correspondientes. |
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
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | Configuración pública de la app Web de Firebase para verificar correo con Google. El proyecto debe coincidir con Railway. |

La raíz del proyecto debe ser `frontend`; Vercel detecta Next.js y ejecuta `npm run build`. La reescritura definida en `frontend/next.config.ts` envía `/api/:path*` a `BACKEND_URL/api/:path*`. La URL del backend y el token público se incorporan al construir la web: aplicar cambios exige un nuevo despliegue del frontend. [Reescrituras externas de Vercel](https://vercel.com/docs/routing/rewrites).

Las claves de OpenAI, Resend, PostgreSQL y Supabase Storage pertenecen a Railway. Nunca deben ser `NEXT_PUBLIC_*`, aparecer en Git ni pegarse en capturas o mensajes.

## Variables de Railway

En el servicio del backend, abrir **Variables** y agregar los nombres y valores por separado, sin copiar comillas de ejemplos de `.env`.

| Nombre | Valor o regla |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL de Supabase compatible con Prisma. La clave de Storage no sustituye esta URL. |
| `NODE_ENV` | `production`. |
| `FRONTEND_URL` | `https://civigo.online,https://www.civigo.online,https://civigo-rho.vercel.app`. Agregar solo los orígenes de previsualización autorizados que se necesiten. Sin rutas ni barra final. |
| `COOKIE_SAME_SITE` | `lax` para las solicitudes `/api` del mismo origen mediante Vercel. |
| `OPENAI_API_KEY` | Clave privada del proyecto de OpenAI. |
| `AI_REPORT_MODEL` | Opcional; `gpt-6.1-sol` por defecto para evaluar reportes. Tiene prioridad sobre `AI_MODEL`. |
| `AI_CHAT_MODEL` | Opcional; `gpt-4.1-mini` por defecto para el chatbot. Tiene prioridad sobre `AI_MODEL`. |
| `AI_MODEL` | Alternativa compatible para ambos servicios cuando falta su variable específica. Si ya tiene `gpt-4.1-mini`, definir `AI_REPORT_MODEL=gpt-6.1-sol` para actualizar la evaluación. |
| `AI_REPORT_MAX_OUTPUT_TOKENS` | Opcional para reportes con Sol; `4096` por defecto, entero entre 1024 y 16384. Incluye razonamiento y respuesta. |
| `AI_TIMEOUT_MS` | Opcional; por defecto 30000 con Sol y 15000 con otros modelos. Admite entre 1000 y 30000 milisegundos. |
| `FIREBASE_PROJECT_ID` | Proyecto de Firebase cuyo proveedor Google verifica el correo. Debe coincidir con la app Web de Vercel. |
| `RESEND_API_KEY` | Clave privada de Resend con permiso de envío. |
| `EMAIL_FROM` | Remitente del dominio verificado, por ejemplo `CiviGo <notificaciones@correo.civigo.online>`. Es una dirección propuesta, no una cuenta creada por el código. |
| `STORAGE_PROVIDER` | `supabase` para archivos en la nube; `local` es el valor por defecto y necesita persistencia propia. |
| `SUPABASE_URL` | URL HTTPS raíz del proyecto Supabase, sin `/storage/v1`, consultas ni credenciales. |
| `SUPABASE_SECRET_KEY` | Clave secreta del backend de Supabase. Alternativa compatible: `SUPABASE_SERVICE_ROLE_KEY`. No usar una clave pública/anon. |
| `SUPABASE_STORAGE_BUCKET` | Nombre del bucket privado existente; por defecto `civigo-attachments`. |
| `UPLOAD_DIR` | Opcional. Directorio temporal de recepción; en modo local debe estar en un volumen persistente. |
| `ENABLE_JOBS` | Dejar sin definir o usar `true` en una única instancia que procese plazos. `false` desactiva ese trabajo periódico. |

`AI_API_KEY` sigue siendo un alias de compatibilidad; se prefiere `OPENAI_API_KEY`, que tiene prioridad. `AI_BASE_URL` no es necesario: el adaptador usa el endpoint oficial Responses. Si existe con el antiguo endpoint oficial Chat Completions, se acepta por compatibilidad y se usa Responses; otros hosts se rechazan para evitar enviar la clave a un destino incorrecto.

El servicio Railway debe usar la raíz `/backend`, compilación `npm run db:generate`, **Pre-deploy Command** `npm run db:migrate && npm run db:seed`, **Start Command** `npm start` y healthcheck `/api/ready`. `node src/server.js` en Start también es válido. El predeploy debe terminar; no colocar el servidor ni `npm start` dentro de ese campo. `db:generate` crea el cliente Prisma; no crea tablas ni aplica migraciones. [Pre-deploy de Railway](https://docs.railway.com/deployments/pre-deploy-command).

Conservar el puerto asignado por Railway y su dominio público HTTPS. El código escucha en `0.0.0.0` cuando se ejecuta en producción/Railway. Al cambiar variables del backend, aplicar el nuevo despliegue del servicio; esto no exige reconstruir el frontend si su `BACKEND_URL` sigue igual.

## Activar OpenAI

1. Crear o usar un proyecto en la plataforma de OpenAI y configurar su facturación y acceso al modelo elegido. Una suscripción de ChatGPT no es una credencial de API para este backend.
2. Crear una clave privada del proyecto y guardarla como `OPENAI_API_KEY` en Railway. Esa misma clave sirve para ambos modelos: `AI_REPORT_MODEL=gpt-6.1-sol` y `AI_CHAT_MODEL=gpt-4.1-mini`. El código nuevo debe estar desplegado para reconocer las variables específicas.
3. Tras aplicar el cambio, comprobar la configuración y realizar una conversación de prueba desde CiviGo. Si la clave o cuota falla, el chatbot identifica su respuesta como **guía de CiviGo**, sin simular una respuesta de IA.

El backend utiliza `POST https://api.openai.com/v1/responses`, salida estructurada para evaluar reportes y un historial breve para el chatbot. Cada petición admite hasta diez mensajes previos; el frontend conserva turnos en memoria, sin guardarlos en localStorage ni crear conversaciones alojadas. El contexto del chatbot incluye una muestra de incidentes públicos y reglas; no incluye autores, sesiones, documentos o pruebas privadas. El texto escrito por el usuario sí se envía al proveedor. La evaluación inicial envía tipo, descripción y fechas; actualmente no analiza imágenes o videos adjuntos.

La evaluación usa un modelo de razonamiento más avanzado que el del chatbot. Con `gpt-6.1-sol` se solicita esfuerzo `low` y se acota la salida total a 4096 tokens, incluidos los de razonamiento. Este presupuesto inicial está comprobado con respuestas simuladas; falta calibrarlo con reportes reales y acceso al proveedor. Si se agota antes de completar el resultado, el reporte pasa al flujo de revisión humana, sin repetir llamadas automáticamente. El modelo admite imágenes, pero el adaptador aún no las envía: cambiar de modelo no activa el análisis de pruebas adjuntas. [Modelo gpt-6.1-sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [presupuesto de razonamiento](https://developers.openai.com/api/docs/guides/reasoning).

Las solicitudes incluyen `store: false`, que desactiva el almacenamiento de las respuestas como estado de aplicación. **No equivale a Zero Data Retention ni elimina por sí solo los registros de seguridad del proveedor**; esos controles requieren condiciones y aprobación adicionales de OpenAI. Revisar el aviso de privacidad antes de abrir la participación pública. [Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses), [controles de datos de OpenAI](https://developers.openai.com/api/docs/guides/your-data).

Un timeout, límite o respuesta inválida devuelve la evaluación a los flujos existentes de revisión humana. Las emergencias acordadas pueden publicarse por evaluar; los demás tipos esperan validación. La evaluación de un agente prevalece. El chatbot explica funciones y datos disponibles: no publica reportes, contacta agentes, cambia cuentas ni garantiza seguridad de las rutas.

Antes de llamar al evaluador se reservan como máximo tres solicitudes por minuto y usuario, incluso si llegan simultáneamente. Esa reserva funciona por proceso; se mantiene también el límite de reportes recientes en PostgreSQL. No sustituye la revisión del consumo y saldo de la cuenta de OpenAI.

## Verificar únicamente Gmail con Google

**Decisión vigente: sólo Gmail verificado habilita la participación.** Se retiraron la verificación telefónica, sus endpoints, adaptadores y panel de aprobación. Seguir [la guía de Gmail](verificacion-contactos.md): habilitar Google en Firebase, autorizar dominios, definir `FIREBASE_PROJECT_ID` en Railway y las cuatro variables públicas de la aplicación Web en Vercel.

Las variables anteriores de teléfono/Twilio ya no se utilizan. La autenticación de Google no cambia la sesión de CiviGo. La administración se realiza desde [la aplicación de escritorio](../desktop/README.md), sin panel ADMIN en el frontend público.

## Activar correo con Resend

1. Crear la cuenta y añadir un dominio remitente. Puede usarse el subdominio `correo.civigo.online` para separar correo transaccional de la web.
2. En GoDaddy, añadir exactamente los registros DNS que muestre Resend y esperar su verificación. No sustituir los registros A/CNAME usados por la web ni registros de correo existentes sin evaluar su función. [Dominios verificados de Resend](https://resend.com/docs/dashboard/domains/introduction).
3. Crear la clave de envío y configurar `RESEND_API_KEY` y `EMAIL_FROM` en Railway.
4. Comprobar los recordatorios de pruebas con datos de prueba. La verificación de cuentas usa Google, sin códigos enviados por Resend.

Un correo se considera aceptado por el proveedor solo si Resend devuelve un identificador válido; la entrega a la bandeja debe verificarse aparte. Los recordatorios llevan claves idempotentes vinculadas al reporte, conservadas por Resend durante 24 horas; no sustituyen su marcado persistente en PostgreSQL. No hay reintentos automáticos en el adaptador. [Envío](https://resend.com/docs/api-reference/emails/send-email), [idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys).

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

En **Administración → Integraciones** de la aplicación de escritorio, solo los administradores pueden consultar el mismo diagnóstico mediante `/api/admin/integrations`. Muestra nombres de variables y estado de presencia/formato; no prueba conexión, saldo, permiso real de Google, remitente verificado ni existencia/privacidad del bucket. `GET /api/health` confirma el proceso; `GET /api/ready` comprueba PostgreSQL, no los proveedores de pago.

### Si el chatbot muestra la guía porque la IA no está disponible

El aviso confirma que la petición al proveedor no produjo una respuesta válida. Por sí solo no identifica un problema de clave, permisos, saldo o tiempo de espera. No hace falta cambiar `BACKEND_URL` ni el token de Mapbox para diagnosticarlo.

Después de publicar esta versión del backend, enviar una sola consulta de prueba desde CiviGo y abrir los **logs de ejecución del servicio en Railway**. Buscar `[CiviGo IA]`, por ejemplo:

```text
[CiviGo IA] {"proveedor":"openai","servicio":"chat","motivo":"HTTP_429","estado":429,"codigo":"credit_balance_exhausted"}
```

El ejemplo ilustra un saldo agotado; no afirma que esa sea la causa del despliegue actual. El registro usa motivos fijos, estado HTTP y únicamente códigos conocidos del proveedor. No incluye claves, conversaciones, descripciones, encabezados ni el mensaje remoto. El detalle queda en los logs del backend; la respuesta pública conserva la guía.

| Dato del registro | Qué revisar |
|---|---|
| `HTTP_401` / `invalid_api_key` | Que la clave siga activa y corresponda al proyecto configurado. Un 401 genérico no demuestra por sí solo una clave incorrecta. |
| `ip_not_authorized` | Restricciones de IP del proyecto u organización. |
| `HTTP_403` / `permission_denied` | Permiso de escritura para Responses y acceso de la cuenta/proyecto al recurso; 403 también puede indicar una restricción regional. |
| `HTTP_404` / `model_not_found` | Nombre exacto del modelo y su disponibilidad para el proyecto. Un 404 sin código no identifica el recurso. |
| `credit_balance_exhausted` | Saldo de créditos de la API en OpenAI. |
| `insufficient_quota` | Facturación, saldo y límites de la organización/proyecto; este código general no permite distinguirlos. |
| `project_spend_limit_exceeded`, `organization_spend_limit_exceeded`, `organization_usage_limit_exceeded` | El límite correspondiente en OpenAI. |
| `rate_limit_exceeded` / `slow_down` | Frecuencia de solicitudes; esperar antes de probar de nuevo. Un 429 genérico no significa necesariamente saldo agotado. |
| `TIMEOUT` / `NETWORK` / `HTTP_5XX` | Latencia, conectividad o disponibilidad del proveedor. |
| `HTTP_400`, `INVALID_JSON`, `INVALID_RESPONSE`, `INCOMPLETE`, `RESPONSE_FAILED`, `REFUSAL`, `EMPTY_OUTPUT`, `OUTPUT_TOO_LONG`, `INVALID_EVALUATION` | Petición o respuesta no utilizable; revisar el adaptador y sus límites sin publicar datos privados. |

CiviGo no repite las solicitudes automáticamente para intentar recuperar estos fallos. Facturación, saldo y permisos requieren resolver la causa antes de volver a probar. [Códigos de error de OpenAI](https://developers.openai.com/api/docs/guides/error-codes).

Antes de considerar activados los servicios, comprobar en el entorno previsto:

- Registro, sesión, rutas y visualización del mapa desde el dominio final.
- Chatbot con continuidad de conversación, modo IA real y fallback visible si el proveedor falla.
- Evaluación de un reporte de prueba y prioridad posterior de la revisión humana.
- Google acredita únicamente el Gmail vigente; un correo sin verificar no permite participar, independientemente del teléfono.
- Ventana de Google bloqueada, cuenta diferente, desafío vencido, firma inválida y límites sin llamadas inesperadas.
- Login ADMIN y gestión desde la aplicación de escritorio; `/admin` ya no ofrece un panel en la web pública.
- Adjuntos persistentes, límites de video/tamaño y permisos sobre pruebas privadas e identidad.
- Reinicio del backend sin pérdida de datos o archivos, y recordatorios/plazos procesados por una única instancia.

Las pruebas automatizadas con mocks y servidores locales comprueban contratos y flujos; no acreditan envíos, cobros o disponibilidad real de las cuentas del propietario. En local se usan `backend/.env` y `frontend/.env.local`, ambos privados. No hay `backend/.env.example` en esta versión: los nombres y valores no secretos se documentan aquí.
