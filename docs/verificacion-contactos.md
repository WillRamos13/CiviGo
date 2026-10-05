# Activar verificación únicamente por Gmail con Google

La decisión vigente del 4 de octubre de 2026 reemplaza WhatsApp/SMS: **para participar en CiviGo se requiere correo verificado con Google**. Se retiró toda opción y endpoint de verificación telefónica. El teléfono queda como contacto privado; no concede ni bloquea participación. El registro nuevo solicita una dirección Gmail. La cuenta y contraseña de CiviGo se conservan.

El usuario no puede enviar un reporte, confirmar incidentes, aportar pruebas o intervenir en chats hasta verificar el correo. La verificación no publica un reporte automáticamente ni sustituye la evaluación de IA/agentes. Un documento privado de identidad para recuperar el dato de contacto se admite antes de verificar: sólo lo ven su propietario y administradores, y no se puede usar como reporte o prueba pública.

## 1. Preparar Firebase

Abrir [Firebase Console](https://console.firebase.google.com/), crear o seleccionar un proyecto para CiviGo y registrar una aplicación Web. Copiar `apiKey`, `authDomain`, `projectId` y `appId` de su configuración. El SDK ya forma parte del frontend.

En **Authentication → Sign-in method**, habilitar **Google**, seleccionar el nombre público y correo de soporte y guardar. En **Authentication → Settings → Authorized domains**, añadir:

```text
civigo.online
www.civigo.online
civigo-rho.vercel.app
```

Escribir sólo dominios, sin protocolo ni ruta. Los dominios nuevos de previews necesitan autorización propia. Para desarrollo local, añadir `localhost` al proyecto de desarrollo. [Configuración oficial de Google](https://firebase.google.com/docs/auth/web/google-signin).

Google acredita la propiedad del correo; CiviGo no lee la bandeja de Gmail ni accede a contactos. La base de datos de CiviGo sigue en Supabase. No se necesitan SMS, Twilio, tokens de WhatsApp ni un JSON privado de Firebase.

## 2. Variable de Railway

En el servicio backend, **Variables → New Variable**:

```dotenv
FIREBASE_PROJECT_ID=
```

Rellenar con el `projectId` exacto del proyecto Firebase. Mantener las variables existentes de PostgreSQL, OpenAI y almacenamiento. Las antiguas `PHONE_VERIFICATION_PROVIDER`, `WHATSAPP_VERIFICATION_NUMBER` y credenciales Twilio ya no se utilizan; se pueden retirar del panel del propietario.

## 3. Variables de Vercel

En el proyecto frontend, **Settings → Environment Variables**, para Production y los entornos que se usarán:

| Variable | Valor de la aplicación Web Firebase |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |

El proyecto debe coincidir con Railway. Estos valores son públicos y se incorporan al build del navegador. Conservar `BACKEND_URL` y Mapbox. Las claves privadas de otros proveedores permanecen en el backend.

Publicar el código actualizado y efectuar nuevos despliegues de frontend y backend mediante el flujo habitual del propietario; las variables públicas requieren recompilar el frontend. No se hizo deploy desde este trabajo.

## 4. Uso

1. Iniciar sesión en CiviGo y abrir **Mi perfil → Verificar Gmail**.
2. Aceptar el aviso de comprobación del correo y pulsar **Verificar con Google**.
3. Pulsar **Elegir mi cuenta de Google** y seleccionar la misma dirección registrada en CiviGo.
4. Comprobar que el correo aparece verificado y que se habilita la participación. Si Google confirma pero falla el guardado en CiviGo, reintentar sin abrir otra ventana.

Los desafíos vencen en diez minutos, con un minuto de espera entre solicitudes y cinco solicitudes por hora. La comprobación exige una dirección `@gmail.com` coincidente, también para cuentas anteriores que aún no estaban verificadas; no acepta Google Workspace de otros dominios. Verifica firma RS256, proyecto, emisor, fecha, proveedor Google y autenticación reciente. Un token refrescado del mismo evento no permite consumir otra solicitud. El token temporal vive en memoria y se elimina al terminar o abandonar el flujo.

## 5. Administración de escritorio

La ruta y el panel ADMIN se retiraron del frontend público. La administración se realiza desde la aplicación de Windows en `desktop/`, con login de una cuenta existente de rol `ADMIN` contra el mismo backend de Railway. [Instrucciones de escritorio](../desktop/README.md). El panel de agentes conserva su revisión limitada en la web.

Las dos cuentas de prueba solicitadas se crean explícitamente con rol `USUARIO` y correo marcado como verificado. Usan el dominio reservado `civigo.test`: son accesos de demostración de CiviGo, no buzones de Gmail ni pruebas reales de OAuth. Sus contraseñas aleatorias se entregan al propietario y no se incluyen en documentación o Git.

## Comprobación real pendiente

Configurar Firebase/variables y desplegar el código actualizado. Probar una cuenta Gmail correcta, otra distinta y los errores de ventana bloqueada/dominio no autorizado. Confirmar que el teléfono no afecta permisos y que un correo no verificado no puede participar. Las pruebas automáticas locales no acreditan la configuración de Firebase del propietario.
