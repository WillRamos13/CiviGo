# Activar WhatsApp manual y verificar Gmail con Google

La decisión para esta etapa es **teléfono mediante WhatsApp con revisión manual del administrador** y **correo mediante Google**. Verificar Gmail no verifica el teléfono: este sigue siendo obligatorio para reportar, confirmar y participar. CiviGo conserva sus cuentas, contraseña y sesiones; PostgreSQL sigue en Supabase.

## 1. WhatsApp: variables de Railway

En el servicio backend, pestaña **Variables**:

```dotenv
PHONE_VERIFICATION_PROVIDER=whatsapp-manual
WHATSAPP_VERIFICATION_NUMBER=
```

En `WHATSAPP_VERIFICATION_NUMBER`, colocar el número que **recibirá** los mensajes de verificación, en formato internacional, sin espacios: prefijo `+51` seguido del número peruano correspondiente. Usar el número del administrador o un WhatsApp de atención de CiviGo. Ese número será visible en el enlace de contacto; no se considera una clave privada.

El flujo no usa Twilio, una API de WhatsApp ni envíos automáticos. El usuario abre WhatsApp y envía un mensaje; un administrador tiene que revisar cada solicitud. No hacen falta tokens de WhatsApp para esta modalidad. La aplicación no envía mensajes en nombre del usuario.

Si no se define el selector y ya hay credenciales válidas de Twilio, se conserva ese proveedor para compatibilidad; si no las hay, se muestra WhatsApp manual. Definir `whatsapp-manual` explícitamente evita dudas. La alternativa `twilio` y sus adaptadores se conservan para instalaciones existentes.

### Uso del usuario

1. Iniciar sesión e ir a **Mi perfil → Verificar contactos**.
2. Pulsar **Preparar mensaje de WhatsApp**. CiviGo crea un código único de 24 caracteres con vencimiento de 24 horas.
3. Pulsar **Abrir WhatsApp** y enviar el mensaje desde **el mismo número que está registrado en la cuenta**. Abrir el enlace no verifica el teléfono ni envía el mensaje por sí solo.
4. Esperar la revisión y pulsar **Consultar aprobación**. Si se recarga la página, se puede consultar el estado; preparar otro mensaje invalida el anterior.

### Uso del administrador

1. Abrir **Administración → Verificar teléfonos** y actualizar las solicitudes.
2. Revisar el mensaje original recibido en WhatsApp. Comprobar el **número real del remitente**; el nombre del contacto o una captura reenviada no bastan.
3. En la solicitud correspondiente, copiar ese número y el código completo recibido.
4. Marcar la confirmación de revisión y pulsar **Aprobar teléfono**. El backend exige número y código coincidentes y que la cuenta siga habilitada y conserve ese teléfono. La aprobación queda registrada en la actividad administrativa.

Solo administradores pueden consultar y aprobar estas solicitudes. El código se guarda como hash; nunca se muestra en la lista administrativa. No hay aprobación automática, incluso si el código aparece en pantalla. El usuario controla el envío y el administrador comprueba de dónde llegó. Un código usado o vencido no vuelve a aprobar otra cuenta. Se permiten cinco solicitudes por hora y una por minuto; una nueva invalida la anterior. Los cinco intentos fallidos de comprobación por solicitud también quedan limitados.

## 2. Google: preparar Firebase

Abrir [Firebase Console](https://console.firebase.google.com/) y crear o seleccionar un proyecto para CiviGo. Registrar una aplicación **Web** desde la configuración del proyecto y copiar estos valores de su configuración: `apiKey`, `authDomain`, `projectId` y `appId`.

En **Authentication → Sign-in method**, habilitar **Google**, elegir el nombre público del proyecto y el correo de soporte solicitado, y guardar. No habilitar Phone ni contratar SMS para este flujo. En **Authentication → Settings → Authorized domains**, añadir:

```text
civigo.online
www.civigo.online
civigo-rho.vercel.app
```

No incluir `https://` ni `/mapa`. Autorizar únicamente los dominios que se usarán realmente. Los dominios nuevos de previews de Vercel necesitan autorización propia. Para pruebas locales, añadir `localhost` únicamente al proyecto de desarrollo; en proyectos recientes no se incluye por defecto.

Google usa una ventana para seleccionar la cuenta y Firebase acredita el correo. No hay lectura de la bandeja de Gmail, envío de correos desde esa cuenta ni acceso a contactos. La configuración pública no es una clave privada de administrador. [Configuración oficial de Google en Firebase](https://firebase.google.com/docs/auth/web/google-signin), [verificación de tokens en el backend](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

Para este uso de Google se puede comenzar con el plan gratuito **Spark**, sujeto a sus límites; no se necesita habilitar SMS ni pasar a Blaze para esta integración. [Planes de Firebase](https://firebase.google.com/pricing).

### Variable de Railway

```dotenv
FIREBASE_PROJECT_ID=
```

Rellenar con el `projectId` exacto del proyecto. El backend comprueba firmas con las claves públicas oficiales de Google; no necesita descargar un JSON de cuenta de servicio ni configurar `FIREBASE_PRIVATE_KEY`. No cambiar las variables existentes de PostgreSQL, OpenAI o almacenamiento.

### Variables de Vercel

En **Settings → Environment Variables**, para Production y los entornos que se usarán:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Copiar respectivamente `apiKey`, `authDomain`, `projectId` y `appId` de la aplicación Web de Firebase. El proyecto tiene que coincidir con Railway. Estos valores se incluyen en el navegador; **nunca poner claves privadas de Google, OpenAI, Supabase o Twilio en variables `NEXT_PUBLIC_*`**. Mantener `BACKEND_URL` y el token público de Mapbox existentes. Las variables públicas necesitan una nueva compilación del frontend para incorporarse.

### Uso del usuario

1. En **Verificar contactos**, aceptar el aviso para comprobar el correo con Google.
2. Pulsar **Verificar con Google** y después **Elegir mi cuenta de Google**.
3. Elegir **la misma dirección de correo registrada en CiviGo**. Una cuenta diferente no verificará el correo ni cambiará el usuario conectado.
4. Confirmar que aparece **Tu correo está verificado**. Si Google confirma y falla la conexión con CiviGo, se puede reintentar el guardado sin abrir otra ventana.

El primer paso prepara la solicitud; el segundo abre la ventana desde un clic explícito, evitando depender de una ventana emergente después de una petición de red. El token se conserva temporalmente en memoria para el reintento y se borra al finalizar o salir de la página. No se almacena una sesión Firebase en localStorage. El backend exige firma válida, el proyecto esperado, proveedor Google, correo verificado/coincidente y autenticación posterior al inicio del desafío. La prueba se consume atómicamente y no puede reutilizarse con un token refrescado.

Las solicitudes de correo con Google vencen en diez minutos, admiten cinco intentos y se limitan a cinco por hora con un minuto de espera. Las pruebas antiguas no acreditan desafíos nuevos. El correo por código con Resend se conserva como alternativa para otras direcciones y para recordatorios, pero **Resend no es necesario para comprobar el correo con Google**. Google no sustituye esos envíos transaccionales.

## Revisar después de publicar los cambios

- **Administración → Integraciones** debe reconocer WhatsApp manual y Correo con Google. El diagnóstico muestra configuración, no acredita una cuenta externa ni realiza envíos.
- Probar que el enlace de WhatsApp abre el número de atención correcto y que los mensajes llegan desde el número registrado. Aprobar desde el panel y comprobar que la cuenta puede reportar.
- Elegir la cuenta Google correcta, luego una distinta para comprobar su rechazo; verificar que la sesión y el usuario de CiviGo se conservan.
- Revisar popup bloqueado, dominio no autorizado, vencimiento, códigos erróneos, cambios de teléfono y permisos administrativos.

Las pruebas automatizadas usan firmas y respuestas locales, sin enviar mensajes, abrir cuentas externas ni modificar producción. Falta comprobar WhatsApp y Google reales después de configurar el número de atención, el proyecto y las variables, y publicar los cambios mediante el flujo habitual del propietario.
