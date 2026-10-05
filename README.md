# CiviGo

Proyecto académico de seguridad y movilidad ciudadana para la provincia de Ica. Web Next.js, API Express, Prisma y PostgreSQL de Supabase.

Stack de despliegue: **frontend en Vercel, backend Node.js en Railway, PostgreSQL y archivos privados en Supabase, y dominio civigo.online en GoDaddy**. La participación requiere **Gmail verificado con Google**: seguir [la guía de activación](docs/verificacion-contactos.md). Se retiró la verificación del teléfono. El panel ADMIN es una [aplicación de escritorio Windows](desktop/README.md), separada de la web pública; los agentes conservan su revisión limitada en la web. OpenAI y Firebase requieren configuración del propietario; Resend se usa para recordatorios.

## Documentación

- [Especificación funcional](docs/especificacion-funcional.md): acuerdos del producto.
- [Registro de avance](docs/progreso-desarrollo.md): implementación, pruebas y pendientes.
- [Informe de entrega](docs/entrega-desarrollo.md): funcionalidades, correcciones y revisión recomendada.
- [Operación y preparación de despliegue](docs/operacion-y-despliegue.md): configuración, comandos y servicios.
- [Integraciones y variables por plataforma](docs/integraciones.md): OpenAI, Gmail/Google, recordatorios, Supabase Storage, mapa y diagnóstico de configuración.
- [Entrega de integraciones](docs/entrega-integraciones-20261004.md): cambios, pruebas locales y activación pendiente de proveedores.
- [Verificación de Gmail](docs/verificacion-contactos.md): Google y variables de Firebase; [entrega actual](docs/entrega-gmail-escritorio-20261004.md).
- [Administración de escritorio](desktop/README.md): desarrollo, configuración, ejecutable Windows y acceso ADMIN.
- [Operación del backend](docs/backend-operacion.md): reglas, permisos y pruebas.

## Desarrollo

Instalar dependencias con `npm ci` en `backend` y `frontend`. Configurar los archivos privados `backend/.env` y `frontend/.env.local` siguiendo [la tabla de variables](docs/integraciones.md). No existe `backend/.env.example` en esta versión. Preparar la base con `npm run db:generate`, `npm run db:migrate` y `npm run db:seed` en backend.

Desde la raíz:

```powershell
node scripts/dev.js
```

Abrir http://localhost:3000. La API se encuentra en http://127.0.0.1:4000. El modo `--local` prepara una base local de desarrollo; la documentación explica sus límites y las cuentas demo opcionales.

## Verificación

Backend: `npm run check`, `npm test` y `npm run integrations:check`. Las pruebas HTTP de integración con PostgreSQL requieren `TEST_DATABASE_URL` de una base de prueba. Frontend: `npm test`, `npm run lint`, `npm run typecheck` y `npm run build`.

El diagnóstico también está en **Administración → Integraciones** en la aplicación Windows: revisa presencia/formato de configuración, sin probar conexiones, saldo o entregas. Los secretos se guardan en Railway; en Vercel van `BACKEND_URL`, el token público del mapa y las cuatro variables públicas Web de Firebase. Los Dockerfiles y Compose son auxiliares opcionales. Las actualizaciones del código no activan proveedores ni publican cambios por sí solas. Los pagos, negocios y canjes se muestran como demostración.

La red vial utiliza datos de © OpenStreetMap contributors, ODbL 1.0.
