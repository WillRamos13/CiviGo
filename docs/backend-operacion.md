# Backend de CiviGo: operación y reglas implementadas

El backend mantiene Express, Prisma y PostgreSQL. Las migraciones son aditivas: los datos y tablas anteriores se conservan. La migración de octubre admite una columna `fechaNacimiento` que ya existía en la base de prueba.

## Ejecución

Desde `backend`:

1. `npm ci`
2. `npm run db:generate`
3. `npm run db:migrate`
4. `npm run db:seed`
5. `npm start`

La configuración local va en `backend/.env`, nunca en el repositorio; en Railway se usa el panel Variables del servicio. `backend/.env.example` no existe en esta versión. Los nombres y pasos están en [Integraciones](integraciones.md). El seed prepara 7 categorías y 22 tipos, sin restablecer contraseñas ni borrar registros.

En Railway se usa la raíz `/backend`, build `npm run db:generate`, predeploy `npm run db:migrate && npm run db:seed`, start `npm start` (equivalente a `node src/server.js`) y healthcheck `/api/ready`. No colocar el servidor en predeploy: ese comando debe terminar antes del arranque. `db:generate` no aplica migraciones.

Para una base local: `npm run db:local`. Las cuentas de demostración requieren `DEMO_PASSWORD` definida explícitamente antes de `npm run demo:seed`; no se imprime su valor. El script conserva las credenciales de una cuenta demo ya creada. Por defecto no crea cuentas demo en Supabase ni en producción.

## Variables del servidor

| Variable | Función |
|---|---|
| DATABASE_URL | PostgreSQL compatible con Prisma; use la conexión adecuada de Supabase. |
| FRONTEND_URL | Orígenes autorizados separados por comas. Obligatoria en producción. |
| PORT | Puerto del servidor, 4000 por defecto. |
| NODE_ENV | `production` para las protecciones de producción. |
| COOKIE_SAME_SITE | `lax` por defecto; `none` solo si la arquitectura requiere cookies entre sitios y HTTPS. |
| STORAGE_PROVIDER | `supabase` para guardar archivos privados en la nube; `local` por defecto. |
| SUPABASE_URL / SUPABASE_SECRET_KEY | URL raíz HTTPS del proyecto y clave privada del backend para Storage. `SUPABASE_SERVICE_ROLE_KEY` se admite como alternativa legacy. |
| SUPABASE_STORAGE_BUCKET | Bucket privado existente; `civigo-attachments` por defecto. El código no lo crea ni cambia su privacidad. |
| UPLOAD_DIR | Directorio temporal de recepción; en modo local necesita un volumen persistente y no se publica como carpeta estática. |
| ENABLE_JOBS | `false` desactiva la tarea periódica. Por defecto revisa plazos cada cinco minutos. |
| DEMO_VERIFICATION | `true` permite códigos locales de demostración. El servidor rechaza esta opción en producción. |
| OPENAI_API_KEY | Clave privada preferida para OpenAI Responses; `AI_API_KEY` es un alias de compatibilidad. |
| AI_MODEL | Modelo elegido por el propietario; `gpt-4.1-mini` por defecto. |
| AI_TIMEOUT_MS | Timeout de IA en milisegundos: 15000 por defecto, entre 1000 y 30000. |
| AI_BASE_URL | Opcional por compatibilidad. Solo endpoints oficiales admitidos; el adaptador utiliza Responses y no envía claves a otros hosts. |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID | Credenciales de Twilio Verify para SMS/WhatsApp. |
| RESEND_API_KEY / EMAIL_FROM | Envío de correo con Resend, incluyendo verificación y recordatorios. |
| ADMIN_EMAIL | Correo de una cuenta ya registrada para el primer administrador mediante `npm run db:bootstrap`; no cambia contraseñas. |
| TEST_DATABASE_URL | Base aislada para pruebas HTTP; las bases remotas exigen autorización explícita. |
| ALLOW_REMOTE_TESTS | `true` habilita pruebas sobre una base remota de prueba expresamente autorizada. |
| LOCAL_DB_PORT / LOCAL_DB_DIR | Puerto y directorio del PostgreSQL local de desarrollo. |

Los adaptadores usan OpenAI Responses, Twilio Verify, Resend y Supabase Storage. Sus contratos se comprueban con respuestas simuladas; eso no acredita un envío real ni activa las cuentas del propietario. El [procedimiento de integraciones](integraciones.md) distingue variables de Railway/Vercel, alta de WhatsApp, DNS de correo y bucket privado.

OpenAI recibe texto e información limitada del reporte o contexto público del chatbot; actualmente no analiza los adjuntos. Se usa `store: false`, sin conversaciones alojadas; esto no equivale a Zero Data Retention. El chatbot muestra guía local si falta clave o falla la respuesta y no ejecuta acciones sobre cuentas o reportes.

## Cuentas y permisos

Contraseñas nuevas: scrypt con sal aleatoria. Sesiones: token aleatorio en cookie HTTP-only; en PostgreSQL solo se guarda su hash. La cookie usa Secure en producción. No se entrega contraseña, token ni evidencia privada en las proyecciones públicas.

La verificación telefónica y de correo admite cinco solicitudes por hora por usuario y tipo, un minuto entre solicitudes y cinco intentos por código. El envío no se reintenta automáticamente ante un timeout. Consumir el código y marcar el destino verificado se hace en una transacción, comprobando que el teléfono/correo siga vigente; solicitudes repetidas de un destino ya verificado no generan nuevos envíos. Solo `approved` de Twilio valida el teléfono; un modo de demostración no sustituye esa aprobación en producción.

Los roles son `USUARIO`, `AGENTE` y `ADMIN`. Los agentes requieren permisos individuales: `revisar`, `resolver`, `reabrir` y `evidencia`, además del distrito correspondiente. Los colaboradores autorizados abarcan la provincia. Los administradores administran también usuarios, catálogo, reglas, negocios y premios.

Las cuentas bloqueadas conservan únicamente el acceso necesario para consultar sus reportes y solicitar revisión. El bloqueo no impide una apelación.

Las contraseñas antiguas que no estén almacenadas con el formato compatible no se aceptan como texto plano. `npm run passwords:migrate` hace un diagnóstico sin modificar datos. Su opción explícita `--apply` transforma el almacenamiento conservando la contraseña original; no se ejecuta automáticamente.

## Reportes e incidentes

Los delitos individuales —robo, hurto, intento de robo, amenazas y extorsión— no se agrupan ni aceptan votos comunitarios. Sus adjuntos iniciales se convierten en pruebas privadas. Un revisor necesita permiso de evidencia para validarlos o declararlos falsos.

Si hay filas en `Incident` pero `/api/incidents` devuelve una lista vacía, comprobar `publicado`, `estado` y la fecha del hecho: la consulta pública excluye registros sin publicar y antecedentes de más de tres años. La migración `20261004120000_restore_legacy_incident_visibility` corrige los incidentes activos del prototipo que quedaron ocultos al añadirse `publicado` con valor inicial `false`. Identifica esos registros mediante el historial real de la migración de workflows y las fechas que añadió; conserva su evaluación pendiente, confianza y gravedad, restaura la fecha original y registra cada cambio en `AuditLog`. No publica reportes modernos, registros revisados o retirados, ni concede puntos. En bases creadas con `db push` o con una baseline sin fechas reales de ejecución, no intenta adivinar cuáles son antiguos: deben revisarse mediante el panel administrativo.

La agrupación comunitaria utiliza tipo, cercanía de 50 m y tres horas desde la primera publicación. La ubicación se asigna al distrito geográfico disponible en la red vial. Un distrito suministrado que contradiga los límites se rechaza. No se sustituyen los límites reales por un rectángulo.

La gravedad es nullable cuando falta evaluación. Los siete tipos de emergencia acordados se publican por evaluar si falla la IA; los demás esperan revisión. La confianza comunitaria aumenta gradualmente; el autor inicial no puede confirmarse a sí mismo. Las decisiones humanas prevalecen.

Los votos son únicos por persona, incidente y acción. Cinco resoluciones cercanas retiran el incidente; un agente autorizado puede resolverlo directamente. La reapertura ciudadana es una solicitud para revisión, y la reapertura efectiva requiere permiso autorizado.

## Archivos y plazos

Máximo tres archivos por aporte; máximo 15 MiB por archivo. Fotos JPEG, PNG, WebP o GIF, y videos MP4/MOV (QuickTime de cámara)/WebM. El servidor verifica la firma del contenido. Los videos necesitan metadatos de duración verificables y no pueden exceder 30 s. Un WebM sin duración disponible se rechaza con un mensaje específico.

Los PDF se aceptan únicamente como documentación privada. Los documentos de identidad solo son accesibles para su propietario y administradores. Las pruebas de incidentes necesitan autoría o permiso de evidencia y distrito. Los archivos no se sirven como una carpeta estática pública.

Con `STORAGE_PROVIDER=supabase`, incluso los adjuntos públicos se guardan en un bucket privado y cada descarga pasa por los permisos/publicación del backend. Un bucket público o inexistente bloquea la operación; no se cambia automáticamente ni se usa disco efímero como fallback silencioso. Los registros anteriores en disco conservan su ruta y requieren que ese almacenamiento siga disponible. El límite de 15 MiB también debe comprobarse de extremo a extremo a través del dominio de Vercel; no se ha acreditado una subida real de ese tamaño al proveedor por las pruebas simuladas.

Los plazos se cuentan desde `fechaPublicacion`, separada de la fecha del hecho y del envío del reporte. Desde el día 1 hasta antes del día 7 se intenta enviar el recordatorio de pruebas si existe correo configurado; solo se marca enviado cuando Resend devuelve un identificador válido. El recordatorio conserva una clave idempotente para reintentos de la tarea, sujeta a las 24 horas de idempotencia del proveedor; la aceptación no garantiza recepción en la bandeja. Sin pruebas, el peso baja al 25% al día 3 y el registro se retira al día 7. Si las pruebas ya llegaron, se preserva el caso para revisión humana: la demora del personal no provoca retirada automática. El chat individual igualmente cierra a los siete días. Una reapertura autorizada renueva la ventana de publicación, pruebas y chat sin alterar la fecha del hecho.

La revisión de plazos relee pruebas y validación dentro de una transacción; no sobrescribe una evaluación humana concurrente. La tarea periódica evita ejecuciones superpuestas en el mismo proceso.

## Parámetros iniciales de demostración

Valores técnicos provisionales, editables por administración:

- Reporte validado: 10 puntos de participación.
- Primeros tres autores distintos: 100%, 75% y 50%; aportes posteriores conservados sin premio de autor adicional.
- Confirmación de un incidente posteriormente validado: 2 puntos.
- Pruebas aceptadas: 3 puntos por reporte, una sola vez.
- Premios iniciales por puesto: 100, 80, 60, 50, 40, 30, 20, 15, 10 y 5 monedas.
- Empates: promedio de los premios de los puestos involucrados, incluido un empate que cruza el puesto 10.
- Separación inicial entre tarjetas: 150 m; duración: 6 s; proximidad: 50 m.
- Canjes, catálogo comercial y Premium son demostración. No se procesan cobros ni se afirma entrega real.

Los puntos y premios se conceden mediante claves idempotentes. El cierre mensual usa la zona America/Lima y conserva un registro inmutable; cambios futuros en la configuración no alteran retrospectivamente los premios asignados. Monedas y stock se reservan en una transacción; cancelar un canje devuelve ambos una sola vez.

Una fotografía pública o prueba privada vinculada a un reporte validado habilita los puntos de prueba una sola vez por reporte. Si el material llega después de la validación, el sistema liquida esos puntos al vincularlo sin exigir otra revisión del mismo incidente. La documentación de identidad no genera puntos de prueba.

## Validación

`npm run check` revisa sintaxis de fuente, scripts y tests.

`npm run integrations:check` y el panel **Administración → Integraciones** comprueban presencia/formato de variables, sin llamadas externas ni valores secretos. No prueban conectividad, saldo, habilitación de WhatsApp, dominio remitente ni bucket. `npm run integrations:check -- --strict` falla cuando alguna configuración de proveedor está pendiente o es inválida. `/api/health` confirma el proceso y `/api/ready` comprueba PostgreSQL, no los proveedores externos.

`npm test` ejecuta pruebas unitarias. Las pruebas HTTP se omiten cuando no existe TEST_DATABASE_URL; eso se informa como omitido, nunca como verificado.

Para integración real, proporcionar TEST_DATABASE_URL de PostgreSQL local y ejecutar:

`node --test --test-concurrency=1 tests/*.test.js`

Por defecto los tests rechazan una URL de base remota. Para una base de prueba remota autorizada expresamente, se exige `ALLOW_REMOTE_TESTS=true` y `node scripts/run-integration.js --remote`; nunca se ejecutan con NODE_ENV=production. Generan datos identificados, usan solicitudes HTTP reales, verifican permisos, archivos, agrupación, votos, revisión, canjes y rutas, restauran configuración temporal y eliminan exclusivamente sus propios datos. En PGlite se desactiva la caché de prepared statements y los clientes se ejecutan secuencialmente.
