# Red vial de Ica

`ica-roads.json` contiene la respuesta de OpenStreetMap/Overpass para vías de la provincia de Ica y límites administrativos provinciales y distritales. La fecha y consulta exactas están en el archivo. El importador comprueba que haya vías y conserva procedencia, atribución y licencia.

- Fuente: OpenStreetMap contributors, mediante Overpass API.
- Atribución: © OpenStreetMap contributors.
- Licencia declarada: Open Database License (ODbL) 1.0.
- Información de atribución y licencia: https://www.openstreetmap.org/copyright

Actualizar con `npm run roads:import` en backend y reiniciar la API. No se actualiza automáticamente durante un viaje. El parser divide vías en nodos de intersección reales; puentes que cruzan sin compartir un nodo no se consideran conectados. Las restricciones viales del modo se respetan; no se promete una navegación con giros o tráfico actualizados.
