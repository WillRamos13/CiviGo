# Entrega vigente: Gmail y administración de escritorio

Esta actualización cumple la decisión del propietario del 4 de octubre de 2026 y reemplaza las alternativas anteriores de verificación telefónica. Los accesos de prueba se entregan por el chat, sin guardar contraseñas en Git.

## Implementado

- Verificación de cuentas únicamente por Gmail con Google/Firebase. Se retiraron la pantalla, rutas, adaptadores y aprobación por teléfono, WhatsApp/SMS y códigos de correo.
- Participación protegida por `correoVerificado` en frontend y backend: envío de reportes, confirmaciones, chat y pruebas. Un teléfono marcado como verificado anteriormente no concede permisos.
- Registro de cuentas nuevas con Gmail; teléfono conservado como contacto privado requerido. Las cuentas existentes conservan su login, y cambiar el teléfono no exige una nueva verificación telefónica.
- Protección de publicación de reportes: el autor se vuelve a comprobar después de esperar la IA. Los incidentes ciudadanos necesitan un autor con correo verificado para su visibilidad pública y las decisiones de activación. Los antecedentes administrativos sin reportes ciudadanos conservan su tratamiento.
- Verificar el correo no publica automáticamente reportes pendientes ni sustituye la evaluación de IA/agentes. Los aportes legados no elegibles se conservan para revisión, sin borrar registros.
- Panel ADMIN retirado de la web: ruta `/admin`, navegación y componentes administrativos. Los agentes conservan `/agente` con permisos y ámbito de revisión.
- Aplicación independiente de escritorio Windows en `desktop/`, con interfaz local y autenticación ADMIN contra el mismo backend. No abre el antiguo panel remoto como una página web.
- Dos cuentas nuevas de rol `USUARIO`, correo verificado y contraseña aleatoria protegida con scrypt, creadas por solicitud explícita. Sus correos usan `civigo.test`, reservado para demostración: no son buzones reales de Gmail ni se afirma una comprobación OAuth para ellos.

## Archivos principales

| Área | Archivos |
|---|---|
| Cuenta y verificación | `backend/src/lib/auth.js`, `routes/users.js`, `lib/firebase-email.js`, `frontend/app/verificar/page.tsx`, `components/AuthGate.tsx`, `AuthForm.tsx`, `lib/session.ts` |
| Publicación y revisión | `backend/src/lib/publication.js`, `lib/workflows.js`, rutas `reports`, `incidents`, `navigation`, `community`, `admin` |
| Escritorio | `desktop/electron/main.cjs`, `preload.cjs`, `policy.cjs`, `client.cjs`, `desktop/src`, `desktop/package.json` |
| Cuenta demo explícita | `backend/scripts/create-demo-users.js`, `backend/tests/demo-users.test.js` |
| Interfaz ciudadana/agente | Perfil, mis reportes, IncidentPanel, Shell y componentes restantes de revisión de agentes |
| Documentación | [Activación Gmail](verificacion-contactos.md), [Aplicación Windows](../desktop/README.md), especificación, integraciones y operación |

## Errores y controles corregidos

- La bandera telefónica antigua ya no habilita participación ni se presenta como requisito.
- Una revocación de correo durante la evaluación de IA impide guardar/publicar el nuevo reporte.
- Validar, reabrir o aceptar una apelación de un incidente legado no lo publica si todos sus autores siguen sin verificar el correo.
- Lecturas públicas de mapa, rutas y chatbot aplican la elegibilidad sin borrar datos ni alterar la revisión humana.
- Las agrupaciones no premian ni validan automáticamente aportes de autores que no cumplen el nuevo requisito.
- Los votos antiguos de cuentas sin verificar no cuentan para confirmar ni resolver incidentes.
- El ranking del mes y su nuevo cierre excluyen cuentas sin verificar, incluso si conservan puntos anteriores; los cierres históricos no se reescriben.
- En una agrupación mixta, la vista pública omite textos, adjuntos y conteos de aportes sin correo verificado. Sólo pruebas de autores verificados afectan los cálculos de navegación. La administración conserva los aportes para revisión.
- La recuperación permite subir identidad privada aunque el correo esté pendiente; ese documento sólo es accesible por su dueño y ADMIN y no sirve como evidencia o reporte.
- Se rechaza la verificación Google de correos de otros dominios, incluso en cuentas legadas. Se conserva el login anterior y la verificación administrativa explícita de las cuentas demo.
- En escritorio, las cookies se conservan únicamente en el proceso principal; el renderer sólo usa operaciones IPC restringidas. No recibe claves de PostgreSQL, Firebase privadas ni cookies de sesión.
- Las descargas privadas se vinculan a la sesión que las pidió, para evitar guardar un archivo de una cuenta después de cambiar de usuario.
- Cancelar lecturas al cambiar de panel libera las solicitudes del proceso principal, y un refresh antiguo no borra un login posterior.

## Pruebas y comprobaciones

| Comprobación | Resultado |
|---|---|
| Frontend: `npm test` | **68 aprobadas, 0 fallos** |
| Frontend: TypeScript, lint y build Vercel local | Correctos; `/admin` ausente y `/agente` conservado |
| Backend completo local | **215 aprobadas, 0 fallos, 0 omitidas**; revisión de sintaxis correcta |
| Cuenta demo: hash/rol/verificación/contraseñas independientes | Dos pruebas unitarias aprobadas |
| Dos cuentas solicitadas en Supabase | Creación y hashes comprobados; correo verificado, rol USUARIO y teléfono sin verificar |
| Login real de ambas contra Railway | HTTP200 en login y perfil; correo verificado confirmado; sesiones de comprobación cerradas |
| Configuración Firebase local | Variables ausentes; flujo real pendiente de configuración del propietario, sin cambios en paneles externos |
| Escritorio: TypeScript y build Vite | Correctos |
| Electron real con API local simulada | **12/12 paneles**, 36 llamadas locales; roles, aislamiento, descarga, cambio de sesión y CSP correctos |
| Revisión visual de Electron | Login y panel capturados e inspeccionados; logo y colores de CiviGo |
| Escritorio: pruebas Node | **26 aprobadas, 0 fallos** |
| Paquete ASAR real en Electron oculto | **12/12 paneles**, 36 llamadas locales; módulos, preload y assets reales del paquete comprobados |
| Windows: instalador y portátil | Generados con logo nativo y GIF admitido; recursos de icono verificados |
| Revisión del paquete | Sin `.env`, pruebas, datos privados ni frontend; módulos principales idénticos a sus fuentes |

Los tests generales usan PostgreSQL local aislado y respuestas/firma simuladas de proveedores. La única escritura remota de este bloque fue la creación explícita de las dos cuentas solicitadas y sus sesiones de comprobación, posteriormente cerradas. No se publicaron reportes reales ni se modificaron usuarios previos.

## Decisiones técnicas

Se conserva Next.js/Express/Prisma/Supabase, sin nuevas migraciones para esta decisión. Google acredita identidad del correo; CiviGo mantiene cuentas, contraseñas y sesiones. La bandera telefónica del esquema queda sólo por compatibilidad de datos legados y no participa en la autorización.

La aplicación Windows usa Electron/React y una copia local de los paneles existentes, con aislamiento de contexto, sandbox, Node deshabilitado en renderer, CSP restrictiva, rutas API limitadas y permisos del backend por cada operación. Se retiran las rutas y componentes administrativos del frontend público. El paquete sólo incluye el cliente y su interfaz: no incluye fuentes del backend, variables privadas, scripts de pruebas ni datos de demostración.

## Entregables Windows

- [Aplicación portátil](../desktop/release/CiviGo-Administracion-Portable-0.1.0.exe): 130717749 bytes; abrir sin instalar.
- [Instalador](../desktop/release/CiviGo-Administracion-Instalador-0.1.0.exe): 130982027 bytes; instalación para el usuario actual.
- [Instrucciones de escritorio](../desktop/README.md) y [checksums SHA256](../desktop/release/SHA256SUMS.txt).

Ambos paquetes carecen de firma de código del propietario. La prueba usa el runtime real de Electron y los módulos/recursos del ASAR, con API local simulada; no ejecuta el instalador ni acredita login de un ADMIN real contra producción. Se comprobaron de forma separada los logins reales de los dos usuarios demo pedidos. Las carpetas de compilación, ejecutables y accesos privados están excluidos de Git; el código de escritorio y su lockfile se incluyen.

## Pendientes y revisión del propietario

Configurar Firebase con Google y dominios autorizados, `FIREBASE_PROJECT_ID` en Railway y las cuatro variables Web públicas en Vercel. Publicar el código actualizado por el flujo habitual; no se hizo commit, push o deploy desde este trabajo. Las dos cuentas demo pueden iniciar sesión ya, pero la nueva regla de participación requiere que se publique la versión actualizada.

Para administrar, usar una cuenta de rol `ADMIN`; las dos cuentas pedidas son ciudadanos de prueba, no administradores. El primer administrador se prepara con `ADMIN_EMAIL` y `npm run db:bootstrap` en el entorno del backend configurado; conserva su contraseña y no sustituye administradores existentes.

Comprobar Google real desde el dominio público y en móvil, reportar con una cuenta verificada y comprobar el rechazo de una sin verificar. Abrir la aplicación de escritorio y verificar login administrativo, revisión de incidentes y descargas privadas. Las cuentas externas de Google y su configuración no se crearon automáticamente.
