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

## Mapa, navegación y anuncios

La pestaña `/mapa` incorpora paneles flotantes, navegación GPS con voz, recálculo desde la ubicación actual y llegada automática. Ofrece rutas de menor riesgo, más rápida y equilibrada; los criterios coincidentes comparten un trazado. Los recorridos guardados conservan su advertencia hasta actualizar sus condiciones. La navegación web requiere mantener la página abierta.

En **Railway → servicio backend → Variables**, añade `TOMTOM_API_KEY` y `TOMTOM_ENABLED=true`. La clave nunca va en Vercel ni lleva el prefijo `NEXT_PUBLIC_`. Antes de activar, ejecuta `npm run db:migrate`: la novena migración crea anuncios, moderación y contadores de uso. Puedes mantener `TOMTOM_ENABLED=false` para usar solo los recorridos locales. No es necesario cambiar `BACKEND_URL` de Vercel.

TomTom Orbis aporta flujo y avisos temporales, y tiempos de tráfico para automóvil cuando su trazado coincide con el recorrido permitido de CiviGo. A pie y bicicleta conservan el cálculo local. Si faltan clave, cuotas, coincidencia o servicio, todas las opciones comparan tiempos locales y lo indican. Riesgo y tráfico tienen colores y leyendas separados; los incidentes permanecen independientes de esa elección. Los avisos TomTom no generan chats, reputación, premios ni riesgo histórico.

Los límites mensuales por defecto se acotan a la [gratuidad publicada de TomTom](https://docs.tomtom.com/pricing): 20 000 cálculos, 2 500 consultas de incidentes y 200 000 teselas. Los intentos se reservan de forma atómica en PostgreSQL y la caché reduce consultas repetidas. Estos contadores cubren CiviGo, no otros proyectos que compartan tu cuenta TomTom; ajusta los límites si la utilizas fuera de este proyecto.

La aplicación Windows **0.3.0** permite gestionar novedades/anuncios programados y ocultar o restaurar avisos externos con motivo y auditoría. Los anuncios de negocios abren su ficha; Premium puede ocultarlos y mantiene las novedades. Las imágenes inconclusas o incompatibles y los fallos de IA envían los reportes a revisión humana. Los adjuntos posteriores siempre se revisan por una persona. El chatbot limita sus respuestas a CiviGo, movilidad y seguridad ciudadana, con formato de texto seguro y fechas de Perú.
