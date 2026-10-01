# Avance de gestión, ranking y recompensas

Actualizado el 1 de octubre de 2026. Este registro complementa los avances de backend y frontend; no representa un despliegue.

## Implementado

- Páginas `/admin` y `/agente` con revisión de incidentes, evaluación humana de gravedad, falsedad, resolución, reapertura y clasificación. El servidor limita el ámbito por distrito y permiso; las pruebas privadas requieren autorización.
- Administración de cuentas: roles, tipo de agente, distrito, permisos, bloqueo y activación de Premium de demostración. Ajustes explícitos de puntos mensuales y monedas con motivo y auditoría, sin cambiar credibilidad.
- Catálogo editable de categorías y tipos; configuración del piloto; negocios y tarjetas publicitarias; recompensas con stock y canjes de demostración; cierre mensual de ranking; apelaciones y recuperaciones documentales.
- Importación administrativa de históricos CSV/JSON con vista previa, errores por fila, atribución de fuente y confirmación de importación. Se exige un archivo real, sin inventar antecedentes ni incluir documentos personales.
- Consulta de auditoría y ejecución manual de plazos de reportes.
- Corrección del resumen administrativo: una decisión sobre un incidente recarga los contadores; cambiar de herramienta también actualiza el resumen y existe recarga manual. Los filtros y la selección del panel activo se conservan.
- Ranking público mensual con nicknames, puntos y monedas estimadas/asignadas. El reparto en empates incluye la frontera del décimo puesto y conserva el resultado del cierre.
- Recompensas con saldo acumulable, solicitud de canje y estados claros. Premium presenta S/5,90 como referencia y explica su activación administrativa; no cobra ni promete una suscripción contratada.

## Archivos principales

- `frontend/app/admin`, `agente`, `ranking`, `recompensas`, `premium`.
- `frontend/components/management` contiene los paneles y utilidades de consulta con errores reales de API.
- `backend/tests/management.integration.test.js` prueba los contratos HTTP de administración, recompensas, límites de favoritos, privacidad, ajustes, históricos, empates y recuperación de cuenta.
- `backend/src/lib/roads.js`, `risk.js` y `navigation.js`: correcciones y optimización adicionales autorizadas durante la revisión final. `road-access.test.js`, `road-coverage.test.js` y `risk-spatial.test.js` verifican estos cambios.

## Verificación

- TypeScript completo de frontend: correcto.
- ESLint de todos estos paneles y páginas: correcto, sin advertencias.
- Sintaxis Node del archivo de integración: correcta.
- 22 pruebas de acceso vial, cobertura, navegación, riesgo e índice espacial: correctas. El índice conserva la atribución exacta frente a una búsqueda exhaustiva, incluyendo empates, curvas, límite de 150 metros y geometrías desmesuradas con respaldo de búsqueda completa.
- Red real: se conservaron los 36.525 tramos originales; las rutas utilizan 36.481 tramos enteramente dentro de la provincia. La preparación se guarda en memoria y se reutiliza. En la muestra de 100 hechos la búsqueda exhaustiva tardó aproximadamente 1–2 segundos y la atribución indexada 32–49 milisegundos; se registra la medición sin un umbral de prueba dependiente del equipo.
- La suite administrativa HTTP real pasó sus ocho subpruebas en la base Supabase de prueba autorizada: roles/bloqueo, configuración/catálogo, negocios/stock/canjes, favoritos y privacidad Premium, ajustes de puntos/monedas, importación histórica idempotente, reparto de empates y snapshots de ranking, recuperación de cuenta y auditoría. La limpieza conservó los registros ajenos a estas pruebas.
- La revisión manual del navegador confirmó la validación administrativa de un robo real de prueba. Detectó contadores antiguos en el resumen; se corrigió la actualización del padre y la comprobación TypeScript/ESLint posterior pasó.

## Decisiones

- Se conservó la arquitectura y los componentes compartidos de autenticación y API. Las decisiones de seguridad, stock, saldo, permisos y validación se comprueban en el servidor.
- Publicidad, Premium y premios son demostraciones; no hay pagos, cobros ni entregas reales.
- Los formularios no muestran JSON interno. Las fallas de un servicio se presentan como errores, sin simular éxito.
- La importación muestra una vista previa antes de escribir y no ofrece un inventario histórico ficticio.
- El acceso por modo respeta la jerarquía de etiquetas [OpenStreetMap](https://wiki.openstreetmap.org/wiki/Key:access): la restricción más específica prevalece y puede admitir una excepción, como `foot=yes` sobre `access=no`. Para el piloto se excluyen las vías que requieren permiso, condición especial o solo acceso al destino; el sistema todavía no acredita esas condiciones individuales. No se usa `access=yes` para convertir una vía peatonal en calle vehicular.
- Se excluye del grafo de rutas un tramo cuya geometría sale de cobertura. La comprobación divide cada arista por sus intersecciones con el límite provincial, detectando concavidades y agujeros; no inventa conexiones ni recorta la fuente OSM. Los extremos exactamente en el borde siguen siendo válidos.
- La cuadrícula espacial solo selecciona candidatos: la distancia final se calcula con la misma proyección exacta y se conserva el orden para los empates. La red permanece estática durante el proceso; al actualizar el archivo vial se debe reiniciar la API, como indica la documentación operativa.

## Pendientes externos

- Contratar/configurar los proveedores de SMS o WhatsApp, correo e IA.
- Entregar una fuente de hechos históricos verificable y el catálogo real de negocios y premios.
- Decidir y autorizar posteriormente el alojamiento y despliegue; durante este trabajo no se publicó producción.
- Revisar visualmente el piloto con teléfonos reales, permisos de cámara/GPS, administrador y agente de cada distrito.

## Reparación del ayudante local opcional

Se reprodujeron dos defectos de `@electric-sql/pglite-socket` 0.2.11: un rechazo interno dejaba detenida la cola y un cierre por error conservaba una conexión lógica fantasma. Además, un error SQL en el protocolo extendido producía un `ReadyForQuery` prematuro y desincronizaba Prisma. Los defectos permanecen documentados en [upstream](https://github.com/electric-sql/pglite/issues/1046), incluyendo el [mensaje prematuro](https://github.com/electric-sql/pglite/issues/958).

`backend/scripts/local-socket-server.js` corrige esos comportamientos exclusivamente para la base local de desarrollo. Conserva una única conexión, restablece la cola en `finally`, espera una operación activa antes de comprobar el rollback, libera siempre la plaza desconectada y filtra el mensaje prematuro hasta `Sync`. La dependencia de socket quedó fijada exactamente a 0.2.11 y una comprobación de su versión/estructura impide aplicar el adaptador silenciosamente a una versión desconocida. No se modificaron el protocolo ni las credenciales de Supabase.

Verificación final en una instancia aislada de desarrollo: las siete migraciones se aplicaron y la suite completa pasó **70 de 70 pruebas, sin omisiones**. Las cuatro nuevas regresiones incluyen error SQL seguido de `SELECT 1` con Prisma, expiración por inactividad, interrupción de un mensaje, desconexión mientras se ejecuta `BEGIN`, rollback y ocho ciclos de consultas HTTP de disponibilidad, catálogo y calles con reconexiones. `npm run check` pasó.

El ayudante continúa siendo una alternativa opcional para desarrollo, con una sola sesión de base de datos. Se deben detener la API y su conexión antes de ejecutar herramientas Prisma externas contra esa misma instancia. No sustituye PostgreSQL normal para concurrencia, producción ni verificaciones de carga. Al actualizar la dependencia se debe revisar y retirar este adaptador cuando upstream resuelva los defectos.

## Revisión de ejecución y preparación para despliegue

- El lanzador espera el puerto local sin cargar Prisma en el proceso padre. El preparador genera el cliente antes de conectar el motor y aplica las migraciones a bases nuevas. Esto evita el bloqueo de la DLL del motor en Windows. Las herramientas Prisma de otras pruebas o API deben terminar antes de regenerar ese mismo cliente.
- Una base local anterior preparada con `db push` se compara con el esquema actual antes de establecer su baseline, conserva un marcador recuperable entre migraciones y no usa `--accept-data-loss` ni `--force-reset`. También conserva el backfill de fecha de publicación para hechos ya publicados; los pendientes permanecen sin fecha de publicación.
- El primer administrador se crea mediante un bloqueo transaccional, conservando contraseña y datos de la cuenta. Dos ejecuciones concurrentes dejan exactamente un administrador inicial y una entrada de auditoría.
- La semilla demo comprueba el hostname PostgreSQL real, evitando que una URL remota con «localhost» en su usuario o nombre de base pase la guarda local. Continúa prohibida en producción.
- Docker excluye archivos `.env.*` privados del contexto, la web tiene healthcheck y Compose acepta un `BACKEND_ENV_FILE` privado configurable. La CI valida Compose, construye ambas imágenes, arranca API/web y prueba escritura del volumen y la reescritura `/api`; también ejecuta las pruebas de frontend. No publica imágenes ni despliega.
- `deploy/nginx.conf.example` prepara HTTPS y redirección del dominio `www`, sobrescribe `X-Forwarded-For` y manda `/api` directamente al backend. `TRUST_PROXY` no se activa por usar Next.js: requiere IP/CIDR del proxy real, ingreso protegido y cabecera sobrescrita. Se documentaron los pasos futuros en `docs/operacion-y-despliegue.md`.

Validaciones de este bloque: **4/4 pruebas operativas aisladas**, incluyendo migraciones nuevas, baseline interrumpida/reanudada sin pérdida del usuario, backfill correcto, promoción inicial concurrente y rechazo de URLs remotas engañosas. CLI real en puerto aislado 55441: generación, siete migraciones y semilla correctas; repetición sin migraciones pendientes. Sintaxis backend, formato, Compose y **17/17 pruebas frontend** pasan. El motor Docker no estaba disponible: las imágenes y la configuración Nginx requieren verificarse en un equipo con Docker/certificados antes del despliegue. No se modificó infraestructura externa ni credenciales.
