# CiviGo

Proyecto académico de seguridad y movilidad ciudadana para la provincia de Ica. Web Next.js, API Express, Prisma y PostgreSQL de Supabase.

Stack de despliegue: **frontend en Vercel, backend Node.js en Railway, PostgreSQL y archivos privados en Supabase, y dominio civigo.online en GoDaddy**. La participación requiere **Gmail verificado con Google**. Se retiró la verificación del teléfono. El panel ADMIN es una [aplicación de escritorio Windows](desktop/README.md), separada de la web pública; los agentes conservan su revisión limitada en la web. OpenAI y Firebase requieren configuración del propietario; Resend se usa para recordatorios.

## Desarrollo

Instalar dependencias con `npm ci` en `backend` y `frontend`. Configurar los archivos privados `backend/.env` y `frontend/.env.local`. No existe `backend/.env.example` en esta versión. Preparar la base con `npm run db:generate`, `npm run db:migrate` y `npm run db:seed` en backend.

Desde la raíz:

```powershell
node scripts/dev.js
```

Abrir http://localhost:3000. La API se encuentra en http://127.0.0.1:4000. El modo `--local` prepara una base local de desarrollo.

## Verificación

Backend: `npm run check`, `npm test` y `npm run integrations:check`. Las pruebas HTTP de integración con PostgreSQL requieren `TEST_DATABASE_URL` de una base de prueba. Frontend: `npm test`, `npm run lint`, `npm run typecheck` y `npm run build`.

El diagnóstico también está en **Administración → Integraciones** en la aplicación Windows: revisa presencia/formato de configuración, sin probar conexiones, saldo o entregas. Los secretos se guardan en Railway; en Vercel van `BACKEND_URL`, el token público del mapa y las cuatro variables públicas Web de Firebase. Los Dockerfiles y Compose son auxiliares opcionales. Las actualizaciones del código no activan proveedores ni publican cambios por sí solas. Los pagos, negocios y canjes se muestran como demostración.

La red vial utiliza datos de © OpenStreetMap contributors, ODbL 1.0.
