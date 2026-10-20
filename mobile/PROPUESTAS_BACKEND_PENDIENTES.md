# Propuestas pendientes fuera de Mobile

Auditoría sólo de lectura del 20 de octubre de 2026. No se modificó ni desplegó backend, infraestructura, proveedores ni bases de datos.

## NAV-001 — Estimación de duración y tráfico

**Causa confirmada:** `backend/src/lib/navigation.js` calcula duración desde `maxspeed` de OSM o una velocidad de respaldo (35 km/h, con tope interno de 80 km/h). No añade demora por cruces, semáforos ni circulación observada. Los 23 minutos no demuestran por sí mismos un error de Mobile: pueden ser la estimación teórica recibida.

`backend/src/lib/navigation-traffic.js` aplica TomTom sólo en modo `driving` y exige coincidencia entre la geometría local y la del proveedor. Si un candidato falla los umbrales de correspondencia, el conjunto vuelve a estimación local. La capa gráfica de tráfico y el ETA con tráfico son capacidades distintas.

**Propuesta:** conservar y publicar por candidato `fuente`, `actualizadoEn`, geometría/versiones utilizadas, motivo de fallback y calidad de cobertura. Auditar el ajuste geométrico y la reversión conjunta antes de flexibilizar los umbrales. Usar velocidades por clase de vía, límites verificables y demoras por intersección respaldadas por datos; calibrar contra recorridos medidos, sin multiplicador universal.

```text
para candidato en rutas:
    estimación = duración_por_aristas_y_giros(candidato, datos_verificados)
    si hay proveedor y modo == driving:
        respuesta = solicitar_ruta_equivalente(candidato)
        si geometría_y_restricciones_compatibles(respuesta, candidato):
            adoptar tiempos por tramo de esa misma geometría
        si no: conservar estimación, indicando causa y edad
    devolver fuente, fecha, cobertura y datos de la geometría efectivamente usada
```

**Pruebas:** mismas coordenadas/modo/hora/geometría; tráfico disponible, cuota agotada, timeout, un candidato incompatible, datos antiguos, vías paralelas, accesos restringidos y demoras conocidas. Comparar recorridos reales, no capturas de instantes distintos.

## RISK-001 — Segmentos de riesgo demasiado largos

**Causa confirmada:** `backend/src/lib/roads.js`, `parseRoads`, corta al final, intersección o nodo con restricción/etiqueta, sin longitud máxima. Una vía OSM larga puede convertirse en un solo segmento. `backend/src/lib/risk.js`, `scoreSegments`, atribuye puntos al segmento más cercano hasta 150 m y distribuye una parte a vecinos por extremos. Una incidencia en medio de un segmento kilométrico termina coloreando su geometría completa. `backend/src/routes/road-map.js` utiliza la misma representación para publicar el riesgo.

Mobile dibuja exactamente los segmentos y niveles recibidos. Reducirlos visualmente sin cambiar su puntuación/semántica sería engañoso.

**Propuesta:** separar aristas topológicas del grafo y subsegmentos de puntuación, con longitud orientativa de 100–150 m y límites adicionales en cruces/cambios verificables. Conservar `parentEdgeId`, offsets acumulados, sentido y calzada. Distribuir riesgo sólo dentro de la distancia geográfica prevista, sin propagar a todo un vecino por compartir extremo. Integrar el coste de riesgo en rutas por solapamiento de offsets y longitud, manteniendo giros y restricciones del grafo.

```text
grafo = construir_grafo_OSM_sin_perder_restricciones()
subsegmentos = subdividir_para_riesgo(aristas, longitud_máxima)
para incidente:
    candidatos = índice_espacial.buscar(radio_geográfico)
    puntuar sólo subsegmentos compatibles con distancia, calzada y sentido
coste_ruta = integral_del_riesgo_por_offsets_en_cada_arista
publicar geometría y puntuación bajo una versión conjunta
```

**Pruebas:** incidente a mitad de vía de 5 km afecta sólo el entorno definido; extremos/intersecciones; calzadas separadas; avenidas paralelas; `oneway`; restricciones de giro; coste proporcional; conectividad y rutas alcanzables iguales antes/después; `geometry.version` y `risk.version` coherentes.

## MAP-001 — Nombres cartográficos

Las etiquetas del mapa base vienen de Mapbox Streets; nombres e instrucciones del grafo proceden de `way.tags.name` de OpenStreetMap en `roads.js`. No son necesariamente la misma revisión. No se sustituyeron «Calle 8/9» por nombres supuestos.

**Propuesta:** identificar el elemento exacto y verificar nombre con cartografía municipal u otra fuente autorizada. Corregir OSM o enviar la incidencia al proveedor correspondiente; actualizar la importación del grafo y mantener origen/fecha/versión y alias oficiales verificados. Pruebas de búsqueda por nombre/alias y consistencia entre etiqueta e instrucciones.

## SEARCH/PLACE/NAV-003 — Datos de lugares y corredor

`backend/src/lib/places.js` y `backend/src/routes/navigation.js` ofrecen búsqueda textual `q`, con resultados locales o TomTom y campos nombre, descripción, fuente y coordenadas. No ofrecen búsqueda exhaustiva por corredor ni ficha con reseñas, horarios, teléfonos o fotografías. `/navigation/plan` acepta origen, destino y modo; no hay contrato de itinerario con múltiples paradas.

Mobile filtra los resultados recibidos por separación geométrica de la ruta; ese filtro no representa distancia de desvío por carretera ni catálogo exhaustivo. Las fichas omiten datos no entregados. Se implementaron paradas mediante tres planificaciones reales individuales (hasta la parada, desde la parada al destino original y referencia directa), confirmación y continuación manual desde GPS preciso. Los tiempos no incluyen el tiempo detenido y no constituyen una optimización conjunta de itinerario; ese límite permanece explícito.

**Propuesta:** servicio de búsqueda por corredor paginado con categorías y deduplicación; ficha del lugar con ID de proveedor y permisos/atribución de cada campo; planificación de itinerarios con waypoints, orden, versión de geometría y tiempos de todos los tramos bajo una misma consulta. No exponer claves privadas en el cliente.

**Pruebas:** corredor curvo, sentidos únicos, POI cercano por línea recta pero inaccesible sin desvío, ausencia de datos, límites/cuotas, cancelación, puntos duplicados, preservación de destino y recálculo tras una parada.

## INT-001 — Notificaciones de progreso e isla de Xiaomi

No es una tarea de backend; se registra aquí como dependencia externa pendiente. Se investigaron las notificaciones oficiales `Notification.ProgressStyle` y Live Updates de Android 16. Requieren versión de SDK compatible y condiciones/permisos específicos de promoción. El proyecto conserva compile/target SDK 35, y no se añadieron permisos, servicio GPS de fondo ni una isla falsa.

La implementación y validación de HyperIsland quedan pendientes de un Xiaomi compatible y de comprobar su contrato oficial de integración. La compatibilidad del emulador Android 17 no demuestra compatibilidad con la interfaz de Xiaomi. Una futura notificación deberá señalar navegación pausada si no existen actualizaciones GPS autorizadas en segundo plano.

Fuentes: [notificaciones de progreso de Android](https://developer.android.com/develop/ui/compose/notifications/progress-centric), [Live Updates oficiales](https://developer.android.com/develop/ui/views/notifications/live-update).
