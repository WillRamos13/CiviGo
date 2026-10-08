# CiviGo Administración para Windows

Aplicación de escritorio independiente, hecha con Electron, React, TypeScript y Vite. Los paneles se cargan desde archivos locales; la aplicación utiliza la API de CiviGo en Railway y la misma cuenta administradora existente. El frontend público queda en Vercel.

El administrador puede revisar incidentes y apelaciones, crear usuarios y gestionar sus permisos, categorías, negocios, recompensas, cierres de ranking, recuperaciones, antecedentes históricos, reglas, auditoría e integraciones. Los botones de adjuntos descargan documentos mediante la sesión del escritorio y el diálogo de Windows, con estado de progreso y errores visibles. El correo se verifica con Google en el sitio público; también puede validarlo o revocarlo un administrador, indicando un motivo que queda en auditoría. No se usan códigos ni verificación telefónica.

En **Usuarios → Crear usuario**, completa identidad, correo, teléfono de contacto, fecha de nacimiento y contraseña de al menos diez caracteres. Puedes elegir Ciudadano, Agente o Administrador; el ciudadano requiere Gmail y el agente requiere su ámbito y permisos. Marcar **Correo verificado** exige explicar la comprobación. La creación conserva la sesión actual del administrador. Una validación manual habilita participación, pero no acredita una autenticación real de Google.

Los aportes con imágenes dudosas, no relacionadas o archivos sin analizar aparecen **En revisión humana**, aunque otro aporte del mismo incidente ya esté validado. Consulta sus adjuntos antes de aprobar el incidente; esa aprobación explícita libera los aportes retenidos. Las confirmaciones comunitarias no los liberan.

Al pulsar **Crear usuario**, **Administrar**, **Revisar** o abrir otro editor, la vista se desplaza al formulario y le da foco. Esto también funciona si repites el mismo botón después de volver al listado; escribir en los campos conserva el foco. La versión instalada se muestra en ingreso y cabecera: utiliza **0.2.1** para esta corrección.

## Ejecutar desde el código

Necesitas Windows de 64 bits, Node.js 24 LTS y una conexión a Internet para descargar las dependencias iniciales y acceder a Railway.

```powershell
cd desktop
npm ci
npm test
npm run dev
```

`npm ci` descarga el runtime oficial de Electron mediante el `postinstall` del proyecto. Si esa descarga se interrumpe, vuelve a ejecutar `npm run setup:electron`. No requiere Docker ni una base de datos local para utilizar el panel.

Inicia sesión con una cuenta que tenga el rol `ADMIN` en el backend. No hay usuario, contraseña ni clave de API incorporados en el programa. Una cuenta `USUARIO` o `AGENTE` no puede acceder. El rol se vuelve a comprobar en el servidor y se actualiza durante la sesión.

Si todavía no existe un administrador activo, el propietario puede registrar primero su cuenta en la web y ejecutar una sola vez `npm run db:bootstrap` desde `backend`, con `ADMIN_EMAIL` definido con el correo de esa cuenta y la conexión de base de datos ya configurada. El script se niega a continuar si hay otro administrador activo; no crea contraseñas ni modifica la información de contacto. Los administradores posteriores se gestionan desde el panel.

## Crear los ejecutables

```powershell
npm run pack
npm run dist
```

El primer comando genera `release/win-unpacked/CiviGo Administración.exe` junto con sus archivos de ejecución. Conserva toda esa carpeta al distribuirlo. El segundo genera estos dos archivos que puedes entregar por separado:

- `release/CiviGo-Administracion-Instalador-0.2.1.exe`: instalación para el usuario actual de Windows, sin necesidad de permisos de administrador.
- `release/CiviGo-Administracion-Portable-0.2.1.exe`: aplicación portátil que se abre sin instalarla.

Esta versión necesita el backend actualizado para crear usuarios y validar sus correos. Instalar el escritorio no despliega los cambios en Railway o Vercel. Este bloque no añade migraciones ni variables de entorno.

Los paquetes locales no se publican ni se suben automáticamente. No incluyen certificado de firma de código; Windows puede mostrar la advertencia de editor desconocido. Firmar una futura distribución requiere un certificado del propietario del proyecto.

El empaquetado reutiliza el runtime instalado en `node_modules/electron/dist` para evitar descargarlo y extraerlo dos veces. El icono del ejecutable conserva el logo proporcionado, dentro de un contenedor ICO con imagen PNG de 256 × 256. El registro `release/SHA256SUMS.txt` de esta entrega permite comprobar los archivos generados.

## Servidor y origen permitidos

La configuración predeterminada utiliza `https://civigo-production.up.railway.app` y envía el origen `https://civigo.online`. No necesitas tokens de Supabase, OpenAI o Mapbox en el escritorio: los proveedores se configuran exclusivamente en sus servicios correspondientes.

El backend debe incluir `https://civigo.online` entre sus orígenes permitidos mediante `FRONTEND_URL`. Si se necesita otro servidor, el propietario de la instalación puede colocar `desktop.config.json` en la carpeta de datos de la aplicación, normalmente `%APPDATA%/CiviGo Administración/`, con este contenido:

```json
{
  "backendUrl": "https://civigo-production.up.railway.app",
  "origin": "https://civigo.online"
}
```

También se puede configurar en el proceso que inicia la aplicación mediante `CIVIGO_DESKTOP_BACKEND_URL` y `CIVIGO_DESKTOP_ORIGIN`; las variables tienen prioridad sobre el archivo. La dirección del servidor debe usar HTTPS, sin `/api`, consultas ni credenciales. HTTP a `localhost` o `127.0.0.1` se admite únicamente cuando se ejecuta el código de desarrollo.

## Sesión y límites

La cookie `HttpOnly` se mantiene en memoria en el proceso principal. No se entrega al renderer, no se guarda en `localStorage` ni persiste al cerrar el programa. Cerrar sesión borra la autorización y cancela las solicitudes pendientes aunque el servidor no responda. Los adjuntos privados se comprueban en el backend; cambiar de sesión mientras está abierto el diálogo de descarga invalida esa descarga.

El renderer tiene aislamiento de contexto, sandbox y Node.js desactivado. No puede realizar solicitudes HTTP directas, cargar páginas remotas, abrir ventanas arbitrarias ni ejecutar comandos. El puente IPC valida el frame de origen, los endpoints, métodos y tamaños. Las solicitudes utilizan HTTPS, no siguen redirecciones y tienen un límite de treinta segundos. Los archivos admitidos son JPEG, PNG, WebP, GIF, PDF y videos MP4, WebM o MOV, con un máximo de 15 MB cada uno.

Los enlaces permitidos a mapa, ranking e incidente se abren en el navegador predeterminado. Los adjuntos se descargan dentro del flujo autenticado del escritorio; no se abre un panel administrativo remoto.

## Comprobar sin usar servicios reales

```powershell
npm test
npm run test:electron
npm run test:package
```

Las pruebas de Node verifican roles, cookies, IPC, URLs, límite de archivos, multipart, sesiones, cancelación de lecturas y enfoque de editores. La prueba de Electron abre una ventana oculta y usa una API simulada en `127.0.0.1`: recorre las doce pestañas, verifica editores visibles con listas de 24 registros, reapertura, creación y guardado de usuarios, aislamiento de Node.js, acceso de administrador, descarga privada, revocación de rol y cierre de sesión. Guarda el resultado y las capturas en `.local/electron-smoke/` y nunca llama a Railway, Google u OpenAI.

`test:package`, después de `pack` o `dist`, repite esa prueba usando los archivos reales de `release/win-unpacked/resources/app.asar`. Utiliza el runtime de desarrollo y la API simulada; no ejecuta ni instala el instalador de Windows ni abre una ventana visible. La conexión al backend real se revisa al iniciar sesión con la cuenta administradora después de configurar el servicio.

La configuración de seguridad sigue las guías oficiales de [Electron](https://www.electronjs.org/docs/latest/tutorial/security), su [protocolo local](https://www.electronjs.org/docs/latest/api/protocol), [Vite](https://vite.dev/guide/) y los paquetes de Windows de [electron-builder](https://www.electron.build/docs/nsis/).
