# Entrega: WhatsApp manual y correo Google — 4 de octubre de 2026

**Registro histórico reemplazado por la decisión posterior del propietario:** únicamente Gmail verificado, sin verificación telefónica, y administración de escritorio. Ver [entrega vigente](entrega-gmail-escritorio-20261004.md) y [configuración actual](verificacion-contactos.md). Los apartados inferiores describen la fase anterior.

## 1. Funcionalidades implementadas

- Verificación del teléfono mediante un mensaje de WhatsApp enviado por el usuario desde su número registrado. Se genera un enlace al número de atención configurado y un código único de 24 caracteres, válido durante 24 horas.
- Bandeja privada **Administración → Verificar teléfonos**. Un administrador compara el remitente real y el código, aprueba la solicitud y deja una auditoría en la misma transacción.
- Verificación del correo actual mediante Google con Firebase Authentication. La sesión temporal de Firebase vive en memoria y no sustituye el ingreso de CiviGo.
- Endpoints de configuración y desafíos Google. El backend comprueba la firma pública, proyecto, emisor, vigencia, autenticación reciente, proveedor Google y coincidencia del correo verificado.
- Límites de solicitudes/intentos, consumo atómico y protección frente a cambios concurrentes, bloqueo y reutilización de la prueba. Los códigos se guardan como hashes; los tokens de Google no se guardan ni se registran en logs.
- Diagnóstico administrativo de WhatsApp manual y correo Google. Se distinguen el correo por código de Resend y la verificación con Google.
- Se conservan las alternativas existentes de Twilio, Resend y demostración local. Google no verifica el teléfono: este sigue siendo obligatorio para publicar, confirmar y participar.

## 2. Archivos principales

| Área | Archivos |
|---|---|
| Backend Google | `backend/src/lib/firebase-email.js`, `backend/src/routes/users.js`, `backend/src/lib/providers.js` |
| WhatsApp manual | `backend/src/routes/phone-verifications.js`, `backend/src/lib/contact-providers.js`, `backend/src/routes/admin.js` |
| Protección y diagnóstico | `backend/src/lib/security.js`, `backend/src/lib/integrations.js` |
| Pantalla y adaptador Google | `frontend/app/verificar/page.tsx`, `frontend/lib/firebase-email.ts` |
| Panel administrativo | `frontend/components/management/PhoneVerificationsPanel.tsx`, `ManagementDashboard.tsx` |
| Errores y configuración | `frontend/lib/api.ts`, `frontend/.env.example`, manifiestos y lockfiles de dependencias |
| Pruebas | `backend/tests/firebase-email.test.js`, `contact-google-manual.integration.test.js`, `verification-flows.test.js` y pruebas existentes afectadas; `frontend/tests/firebase-email.test.mjs`, `api.test.mjs` |
| Guías | [Activación paso a paso](verificacion-contactos.md), [Integraciones](integraciones.md) |

## 3. Bugs corregidos

- Una degradación o bloqueo del administrador durante la aprobación podía conservar permisos anteriores: ahora se vuelven a comprobar dentro de la transacción.
- La recuperación del teléfono dejaba códigos antiguos pendientes y estos podían ocultar solicitudes vigentes en la bandeja: se invalidan los desafíos telefónicos al aceptar la recuperación, junto con la revocación de sesiones.
- Se impide consumir un código para un contacto diferente o una cuenta bloqueada durante la confirmación.
- Un token Google refrescado no puede volver a acreditar el mismo evento de autenticación; dos confirmaciones concurrentes consumen la prueba una sola vez.
- La ventana Google se prepara antes del segundo clic, incluido el resolver de Safari/iOS, para conservar la activación del navegador. Un fallo al guardar permite reintentar sin abrir otra ventana.
- Se reparó una expresión JSX incompleta que ya estaba modificada en `ChatBot.tsx`, conservando la eliminación de la etiqueta IA que había hecho el propietario.

## 4. Pruebas y resultados

| Validación | Resultado |
|---|---|
| Backend completo, `npm run test:integration` | **213 aprobadas, 0 fallos, 0 omisiones**, con PostgreSQL local aislado |
| Pruebas criptográficas del verificador Google, incluidas en la suite | 40 casos con firmas RS256 generadas localmente |
| Flujos HTTP de WhatsApp/Google con base real local, incluidos en la suite | 16 pruebas; aprobación, permisos, recuperación, caducidad, identidad, auditoría y concurrencia |
| Frontend, `npm test` | **70 aprobadas, 0 fallos** |
| Backend, `npm run check` | Sintaxis correcta |
| Frontend, `npm run typecheck`, `npm run lint`, `npm run build` | Correctos; Next.js 16.3.8 genera dieciocho páginas |
| Revisión independiente | Tres hallazgos corregidos; sin otros bypass ni filtraciones detectados en el flujo revisado |

Los tests usan respuestas simuladas de proveedores y claves criptográficas locales. No enviaron mensajes, no consumieron OpenAI, no utilizaron credenciales reales ni modificaron Supabase. La suite completa verifica también los módulos existentes para detectar regresiones.

## 5. Funcionalidades verificadas

- El usuario prepara un mensaje, pero abrir WhatsApp no aprueba su cuenta ni envía nada automáticamente.
- Solo un administrador habilitado puede aprobar; un usuario normal o agente no accede a la bandeja ni al endpoint de aprobación.
- Número y código erróneos, vencimiento y agotamiento de intentos no verifican la cuenta. Repetir una aprobación no crea otra auditoría.
- Una recuperación invalida 200 desafíos WhatsApp anteriores y un desafío SMS, conserva el desafío de correo y permite solicitar la verificación del nuevo teléfono.
- Google verifica exclusivamente el correo registrado. Se rechazan firmas, proyectos, fechas, proveedores y correos incorrectos.
- El correo verificado no concede participación si el teléfono sigue pendiente. Se mantienen la cuenta y sesión de CiviGo.
- Navegar, cambiar de cuenta/contacto, cerrar la ventana y reintentar no reutiliza pruebas de otra cuenta. Se conservan errores públicos controlados.

## 6. Decisiones técnicas

Se conservó la arquitectura Next.js/Express/Prisma/Supabase y el esquema existente de verificaciones. No hacen falta nuevas migraciones. Se añadieron el SDK oficial de Firebase para la ventana Google y JOSE para verificar firmas en el backend; no se requiere una cuenta de servicio ni una clave privada de Firebase.

El teléfono usa revisión humana sin WhatsApp Cloud API ni Twilio. El administrador debe comprobar el mensaje original y el número real del remitente, no una captura o nombre de contacto. La aprobación se audita y las pruebas caducan; no se añadió un interruptor que permita al usuario autoverificarse.

Las claves públicas de Firebase se configuran en Vercel; el identificador del proyecto y el número de WhatsApp van en Railway. Las integraciones existentes mantienen sus variables privadas. Premium y pagos no cambian.

## 7. Pendientes

Configurar los servicios y publicar los cambios mediante el flujo habitual del propietario. Después hay que comprobar una recepción real de WhatsApp, una aprobación administrativa y la ventana Google desde el dominio público, incluida su apertura en móvil/Safari. Las pruebas locales no acreditan la configuración o disponibilidad de las cuentas externas.

## 8. Información necesaria del propietario

- Número que recibirá los mensajes, en `WHATSAPP_VERIFICATION_NUMBER`, y selector `PHONE_VERIFICATION_PROVIDER=whatsapp-manual` en Railway.
- Proyecto Firebase y `FIREBASE_PROJECT_ID` en Railway.
- Cuatro valores públicos de su aplicación Web Firebase en Vercel: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`.
- Habilitar el proveedor Google y autorizar los dominios de CiviGo en Firebase Authentication.

No se inventaron números ni credenciales. No se cambió infraestructura ni se hizo commit, push o deploy. Twilio y Resend no son bloqueos para esta modalidad.

## 9. Qué revisar al volver

Seguir [la guía de activación](verificacion-contactos.md). Tras configurar y publicar, entrar a **Verificar contactos**, enviar el mensaje desde el mismo teléfono registrado y aprobar desde **Administración → Verificar teléfonos**. Elegir en Google el mismo correo de CiviGo y comprobar que ambas verificaciones aparecen por separado. Revisar **Administración → Integraciones**; informa configuración y no sustituye la comprobación real.
