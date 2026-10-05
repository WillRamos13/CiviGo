# Entrega de integraciones — 4 de octubre de 2026

## Actualización de contactos

La decisión vigente del propietario es **verificar únicamente Gmail con Google y administrar desde una aplicación de escritorio**. Se retiraron los flujos de verificación telefónica y OTP por correo. Ver [entrega vigente](entrega-gmail-escritorio-20261004.md) y [configuración](verificacion-contactos.md). Se mantienen Firebase en el frontend y JOSE en el backend para comprobar firmas públicas; Resend sólo envía recordatorios. Los apartados inferiores documentan las fases anteriores y sus resultados en ese momento.

## Resultado

Se revisaron los adaptadores existentes y se completó su integración conservando Next.js, Express, Prisma, la sesión de CiviGo y el despliegue previsto en Vercel/Railway/Supabase. El código está preparado para configurar los proveedores. No se crearon cuentas, buckets, credenciales ni despliegues externos; las pruebas no enviaron mensajes ni utilizaron claves reales.

## Actualización de modelos

Después de aclarar que la evaluación requiere un modelo más avanzado, se separaron las funciones: `AI_REPORT_MODEL=gpt-6.1-sol` para reportes y `AI_CHAT_MODEL=gpt-4.1-mini` para consultas del asistente. Son los nuevos valores por defecto; `AI_MODEL` explícito conserva compatibilidad cuando no hay una variable específica. Una sola `OPENAI_API_KEY` permite configurar ambos. El backend debe actualizarse antes de usar las variables nuevas.

Sol usa esfuerzo de razonamiento bajo, 30 segundos de espera por defecto y 4096 tokens totales inicialmente; para reportes, el presupuesto es configurable entre 1024 y 16384. Una salida incompleta conserva el fallback humano. Las configuraciones se validan por función: un modelo inválido no desactiva el otro, y el diagnóstico administrativo no presenta ambos listos cuando uno falla. Se mantiene la limitación real: la evaluación recibe texto, tipo y fechas; el análisis de fotos y videos sigue pendiente.

También se corrigió un límite que podía eludirse enviando reportes simultáneos: se reservan tres evaluaciones por minuto y usuario antes de llamar al proveedor. La cuota en memoria se aplica por proceso; se conserva el conteo en PostgreSQL como respaldo para reportes ya guardados. La nueva prueba HTTP comprueba concurrencia, separación entre usuarios y rechazo antes de contactar al proveedor.

Validación de esta actualización: **149 pruebas de backend aprobadas, 0 fallos y 0 omitidas** con base local aislada; sintaxis y diff correctos. Las llamadas a proveedores se simularon, sin gasto real ni cambios de infraestructura.

## Diagnóstico de fallos del asistente

Al probar el chatbot en el despliegue, la guía aparecía con el aviso de IA no disponible. El adaptador ocultaba la causa al devolver `null` para todos los errores. Ahora los logs privados del backend distinguen fallos HTTP, timeout, conectividad y respuestas no utilizables mediante `[CiviGo IA]` y campos controlados. Los códigos del proveedor se aceptan únicamente desde una lista cerrada; no se imprime su mensaje, claves ni contenido de usuarios.

La guía y la revisión humana siguen disponibles cuando falla OpenAI. El diagnóstico no convierte la presencia de una clave en disponibilidad confirmada ni repite llamadas automáticamente. Se añadieron pruebas de errores simulados y de separación entre el registro privado y la respuesta HTTP pública. La causa concreta de la cuenta de producción sigue pendiente de comprobar con el nuevo registro; no se hizo una llamada real al proveedor.

Validación de esta corrección: **152 pruebas de backend aprobadas, 0 fallos y 0 omitidas** con PostgreSQL local aislado; sintaxis y diff correctos. La revisión independiente no encontró filtraciones ni alteraciones de los fallbacks. No se modificó el frontend ni se desplegó el cambio.

## Funcionalidades implementadas

- OpenAI Responses compartido por chatbot y evaluación inicial de reportes. Salida estructurada con validación estricta, tiempo de espera configurable y fallback a guía/revisión humana. Compatible con `OPENAI_API_KEY` y el alias anterior `AI_API_KEY`.
- Chatbot con hasta cinco turnos recientes en memoria, respuesta identificada como IA o guía, avisos de fallos, cancelación, reinicio y separación por cuenta. El backend acepta hasta diez mensajes previos y 12.000 caracteres; limita consultas por usuario o conexión anónima.
- Twilio Verify para SMS/WhatsApp: configuración, canal y respuestas validados; solamente una aprobación verifica el teléfono. Códigos ligados al destino vigente, consumo transaccional, cinco solicitudes/hora, enfriamiento de un minuto y cinco intentos por código.
- Resend para verificación y recordatorios: aceptación con identificador, errores controlados e idempotencia. No reintenta automáticamente envíos tras un timeout y no envía recordatorios de pruebas después del plazo.
- Supabase Storage opcional con bucket privado, autorización por cuenta/rol/distrito, descarga desde el backend y rangos de vídeo. Mantiene archivos locales anteriores. Conserva firma, 15 MiB, vídeo de treinta segundos y PDF privado; limpia temporales y revierte el objeto nuevo si falla su registro.
- Panel **Administración → Integraciones**, endpoint exclusivo de administradores y comando `npm run integrations:check`. Muestran requisitos y configuración inválida sin exponer valores; no confunden configuración presente con conexión o entrega comprobada.
- Mensajes de frontend específicos para canales sin habilitar, correo y archivos, conservando la protección contra errores internos o secretos.

## Archivos principales

| Área | Archivos |
|---|---|
| IA | `backend/src/lib/ai.js`, `backend/src/routes/community.js` |
| Contacto | `backend/src/lib/contact-providers.js`, `backend/src/routes/users.js`, `backend/src/lib/lifecycle.js` |
| Archivos | `backend/src/lib/storage.js`, `backend/src/routes/uploads.js` |
| Diagnóstico | `backend/src/lib/providers.js`, `backend/src/lib/integrations.js`, `backend/src/routes/admin.js`, `backend/scripts/check-integrations.js`, `backend/package.json` |
| Interfaz | `frontend/components/ChatBot.tsx`, `frontend/lib/assistant.ts`, `frontend/components/management/IntegrationsPanel.tsx`, `ManagementDashboard.tsx`, `frontend/lib/api.ts` |
| Validación | Tests de IA, chatbot, contacto, verificaciones, archivos, diagnóstico y frontend; fixtures HTTP y `backend/scripts/run-integration.js` |
| Guías | [Integraciones](integraciones.md), [backend](backend-operacion.md), [despliegue](operacion-y-despliegue.md), README y especificación |

## Errores corregidos

- Respuestas incompletas de proveedores podían aparentar envíos exitosos; ahora se comprueba el estado/id esperado.
- Los límites y códigos vencidos de Twilio se diferenciaban mal de una caída general; se conservan errores apropiados.
- Un cambio concurrente de destino podía interferir con la confirmación; la aprobación y consumo se realizan sobre el destino vigente y en una transacción.
- El registro aceptaba correos incompatibles con el adaptador; ahora se rechazan antes de crear la cuenta.
- Los archivos públicos sin incidente publicado podían recibir caché pública; conservan acceso privado y `no-store`.
- El chatbot perdía el contexto y no distinguía una respuesta del proveedor de la guía local; ahora conserva historial acotado y muestra el modo real.
- Las pruebas podían heredar futuras credenciales reales al añadir el alias OpenAI; los fixtures y runner desactivan los proveedores externos, incluso frente a la carga de `.env`.

## Pruebas y resultados

| Validación | Resultado |
|---|---|
| Backend completo con PostgreSQL local aislado/PGlite, `npm run test:integration` | **142 aprobadas, 0 fallos, 0 omitidas** |
| Frontend, `npm test` | **54 aprobadas, 0 fallos** |
| Backend, `npm run check` | Sintaxis válida |
| Backend, `npm run db:generate` | Prisma Client 6.19.3 generado |
| Migraciones en base local aislada | Ocho migraciones aplicadas correctamente |
| Frontend, `npm run typecheck` y `npm run lint` | Correctos |
| Frontend, `npm run build` con modo Vercel y URL pública de Railway | Build correcto; dieciocho páginas generadas |
| Diagnóstico local | Informa claves pendientes; `--strict` falla como corresponde mientras faltan proveedores |
| Revisión Git | Diff sin errores de espacios ni cambios en secretos |

La primera ejecución detectó una expectativa anterior sobre solicitudes de un teléfono ya verificado; se actualizó para comprobar que no envía ni crea códigos y que el enfriamiento sigue funcionando para un teléfono pendiente. Otra ejecución coincidió con el preview conectado al servidor local de una sola conexión: se detuvo el preview y la suite completa pasó. Prisma en Windows se regeneró después de cerrar los procesos que cargaban su DLL. Ninguno de estos ajustes requirió modificar la base remota.

Los contratos de los proveedores se probaron con respuestas simuladas. Los flujos de cuentas, archivos locales, incidentes, revisión, rutas, premios e integración administrativa se probaron mediante HTTP y base local reales. Esto no demuestra recepción de SMS/correo ni disponibilidad de una cuenta externa.

## Verificación visual

En la web local compilada se comprobó ingreso administrativo, tarjetas de variables pendientes, dos consultas del chatbot usando la guía, reinicio de conversación y cierre de sesión. Al abrir la ayuda pública después del cierre no reaparecen mensajes de la cuenta anterior. La cuenta de preview se eliminó y se detuvieron sus servidores.

## Decisiones técnicas

- Mantener adaptadores REST con `fetch`; no añadir SDKs o dependencias innecesarias.
- Usar Responses y `store:false`, sin herramientas que ejecuten acciones ni conversaciones alojadas. Esto no equivale a Zero Data Retention.
- Enviar al chatbot solo contexto público acotado; la evaluación usa tipo, descripción y fechas. No se envían documentos o pruebas privadas automáticamente.
- Mantener la prioridad de revisión humana y los fallbacks de emergencias acordados.
- Conservar `/api/uploads/:id` y el modelo de adjuntos: Supabase Storage no exige migración de esquema ni URLs públicas permanentes.
- Mantener el cálculo local sobre OpenStreetMap, Mapbox como mapa base y permisos GPS del navegador. Premium y pagos siguen en demostración.

## Pendientes y bloqueos externos

- OpenAI: clave privada, acceso al modelo y cuota/facturación disponibles; comprobar conversación y evaluación reales.
- Twilio/Resend: crear las cuentas y configurar Verify/SMS Perú, remitente WhatsApp/WABA y dominio de correo. Comprobar recepción y errores reales.
- Supabase Storage: preparar bucket privado existente y variables del backend. Comprobar persistencia, privacidad y descarga tras reiniciar Railway. Los archivos anteriores en disco no se migran automáticamente.
- Probar subidas válidas grandes hasta 15 MiB desde el dominio público, pasando por Vercel y Railway. El límite de Functions no se asume aplicable a esta reescritura externa.
- La evaluación de fotos/vídeos por IA y una fuente externa de incidentes históricos todavía no están integradas; requieren definir datos/proveedor y privacidad. No se implementaron pagos reales.

## Qué revisar al volver

Leer primero [la guía de activación](integraciones.md). Publicar el código revisado mediante el flujo habitual del propietario; configurar las claves privadas en Railway y las variables públicas del mapa/backend en Vercel. Revisar **Administración → Integraciones** y ejecutar las comprobaciones reales del apartado final de la guía. No pegar secretos en el repositorio ni confundir el panel de configuración con disponibilidad confirmada.
