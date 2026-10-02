# CiviGo — Especificación funcional

Fecha de consolidación: 1 de octubre de 2026. Zona horaria: America/Lima.

Este documento registra los acuerdos de la conversación con el propietario del proyecto. Describe el comportamiento objetivo; no certifica que esté implementado. Las decisiones más recientes de la conversación prevalecen sobre propuestas anteriores.

Estados utilizados:

- **Acordado:** decisión confirmada por el propietario.
- **Criterio delegado:** elección inicial de diseño en los temas que el propietario dejó a criterio del asistente; debe poder revisarse.
- **Pendiente:** detalle sin respuesta o parámetro aún sin definir. No tratarlo como un acuerdo.

## 1. Propósito, alcance y condiciones

**Acordado**

- Proyecto académico con visión de escalar.
- Ámbito inicial: provincia de Ica, Perú. Piloto estimado: 100 usuarios.
- Aplicación web responsiva; no se requiere una aplicación móvil nativa.
- Dominio: civigo.online, adquirido en GoDaddy.
- Base de datos existente en Supabase; sus datos actuales son de prueba.
- Presupuesto mensual inicial indicado: S/30.
- Presentación del primer avance desplegado el 1 de octubre de 2026. El propietario no exige un conjunto mínimo de funciones para esa presentación y pidió no apresurar el desarrollo por la fecha.
- Publicidad, Premium y canjes se presentarán inicialmente como demostración, sin cobros reales.
- Los negocios y premios aún no constituyen un inventario real confirmado.
- Fuera de la cobertura se avisará que CiviGo no dispone de información; no interpretar la ausencia de cobertura como nivel 0.

La arquitectura observada contiene frontend Next.js/React/TypeScript/Tailwind/Mapbox y backend Express/Prisma/PostgreSQL. El propietario confirmó mantener el despliegue público previsto: frontend en Vercel, backend Node.js en Railway, PostgreSQL en Supabase y dominio civigo.online administrado en GoDaddy. No se ha realizado el despliegue.

## 2. Personas, acceso y permisos

### 2.1 Registro y acceso

**Acordado**

- Registro con nombres, apellidos, nickname, correo, teléfono y contraseña.
- Edad mínima: 12 años. El método para comprobarla queda pendiente.
- El público ve el nickname; los nombres personales y documentos no se hacen públicos.
- Un visitante puede consultar el mapa.
- Para calcular rutas hay que crear una cuenta. No hace falta haber verificado todavía el teléfono.
- Para participar —publicar reportes, confirmar o intervenir en chats— se requiere teléfono verificado.
- Verificación telefónica mediante SMS o WhatsApp. Todavía no existe un proveedor contratado/elegido.
- También se solicita verificación del correo. La exigencia exacta de correo verificado para cada acción está pendiente; el propietario dio prioridad al teléfono.
- Cambios de datos de cuenta requieren validación. La recuperación/cambio de teléfono puede usar correo o revisión documental.
- Solo administradores revisan documentos de identidad para recuperación o cambios de teléfono.
- El usuario tiene historial de rutas, favoritos y consulta de recorridos previamente cargados.

### 2.2 Roles

**Acordado**

- Ciudadano: usuario registrado.
- Agente: serenazgo, policía o colaborador de CiviGo, con insignia que distingue su tipo.
- Agentes ordinarios: asignados por distrito.
- Agentes especiales, colaboradores de CiviGo: cobertura de toda la provincia atendida.
- Administrador: tres usuarios particulares con las mismas facultades administrativas.
- Los administradores asignan los permisos de cada usuario/agente.
- Los agentes pueden revisar incidentes, evaluar pruebas y corregir gravedad según sus permisos.
- Los documentos privados del reporte son accesibles únicamente al personal autorizado para revisarlos; los documentos de identidad de recuperación se reservan a administradores.
- Las futuras relaciones con municipios y policía son una intención; no se presupone una integración institucional ya existente.

**Pendiente:** correos de las cuentas administradoras, permisos iniciales detallados, recuperación de cuentas cuando ambos contactos se pierden y condiciones de validación de cambios de nickname/nombres.

## 3. Categorías y catálogo de tipos

**Acordado:** categoría y urgencia son características distintas. Un accidente puede pertenecer a Tránsito y ser una emergencia. La gravedad depende de lo que esté ocurriendo, no solo del nombre del tipo.

| Categoría | Tipos |
| --- | --- |
| Seguridad y delitos | Robo; hurto; intento de robo; amenazas; extorsión; persona sospechosa |
| Emergencias y desastres | Incendio; humo; fuga de gas; inundación; derrumbe |
| Tránsito y movilidad | Accidente vehicular; semáforo dañado; calle bloqueada |
| Infraestructura y servicios | Bache; mala iluminación |
| Convivencia y entorno | Pelea; disturbio; basura acumulada; animal peligroso |
| Búsqueda de personas | Persona desaparecida |
| Otros | Otro incidente |

- Humo y fuga de gas son tipos separados.
- Pelea y disturbio son tipos separados. Disturbio comprende conflictos con concentración de personas, como los asociados a un partido.
- El administrador puede crear y editar categorías, tipos y sus reglas.
- En «Otro», la IA puede evaluar y publicar creando otro tipo, o dejarlo esperando revisión. Queda pendiente concretar cómo asignará categoría y cómo se mantendrá el catálogo sin tipos duplicados.
- Descripción de persona sospechosa: texto libre sobre lo que el usuario considere pertinente, sin exigir una conducta preseleccionada.

### 3.1 Publicación de emergencias durante una falla de evaluación

**Acordado:** los siguientes tipos pueden publicarse inmediatamente si falla la IA y no hay un agente disponible:

- Incendio.
- Accidente vehicular.
- Persona sospechosa.
- Fuga de gas.
- Inundación.
- Derrumbe.
- Disturbio.

Se muestran **por evaluar**, se avisa a un agente y no se inventa una gravedad aprobada. Los demás tipos esperan evaluación de IA o agente para publicarse. La urgencia real se interpreta según la situación descrita.

**Pendiente:** determinar el aporte numérico provisional de un incidente «por evaluar». Mientras no se decida, no equipararlo automáticamente a riesgo cero.

### 3.2 Fotografías, videos y pruebas

**Acordado**

- Fotografía obligatoria como regla general.
- Excepciones: robo, hurto, intento de robo, amenazas, extorsión, persona sospechosa, animal peligroso y persona desaparecida.
- Máximo tres adjuntos: fotos y videos cortos, cargados directamente desde cámara.
- No se utilizan enlaces de TikTok, YouTube u otras plataformas como sustituto del archivo.
- Las pruebas de validación, como documentación de denuncias, son privadas. Se separan de la imagen pública del incidente.

**Pendiente:** duración/peso máximo de video, formatos, admisión de galería del dispositivo y comportamiento de una emergencia sin fotografía cuando no pertenezca a la lista de excepciones.

### 3.3 Ubicación y fecha

**Acordado**

- Regla general: ubicación GPS actual.
- Antes de enviar, preguntar «¿La ubicación es correcta?» y permitir una corrección de hasta 50 metros.
- Se permite marcar otra ubicación y una fecha pasada en robo, hurto, intento de robo, amenazas, extorsión y persona desaparecida.
- Límite de antigüedad del hecho reportado por un ciudadano: una semana.
- La antigüedad histórica se calcula desde la fecha del hecho.
- Los plazos para entregar pruebas se cuentan desde la publicación.
- Las importaciones de antecedentes históricos son un flujo diferente; no se les aplica automáticamente el límite ciudadano de una semana.

## 4. Dos flujos de reporte

### 4.1 Delitos individuales con pruebas privadas

**Acordado explícitamente:** robo, hurto, intento de robo, amenazas y extorsión.

- Cada reporte se mantiene individual, aunque existan otros cercanos.
- No se agrupan ni reciben confirmaciones comunitarias.
- El autor aporta las pruebas; un agente autorizado o administrador las revisa.
- Peso inicial de validación: 50 %.
- Al cumplirse un día desde su publicación, se envía un recordatorio por correo para aportar pruebas.
- Al tercer día sin cumplir la validación por pruebas, su peso baja al 25 %.
- Al séptimo día sin pruebas/validación exigida, se retira del mapa y deja de aportar puntos, conservando el registro con su motivo y estado.
- Si se valida, puede conservar influencia histórica según la tabla de antigüedad.
- El chat está abierto durante los siete días disponibles para confirmar el reporte y luego se cierra.

**Pendiente:** qué ocurre si las pruebas se entregan dentro del plazo pero el personal todavía no termina de revisarlas; cómo proceder si posteriormente se aceptan pruebas de un registro ya retirado.

### 4.2 Incidentes comunitarios

**Acordado**

- Dos o más reportes del mismo tipo, dentro de 50 metros y de una ventana de tres horas entre publicaciones, se representan como un único incidente.
- Pueden agruparse entre tramos distintos si cumplen cercanía y ventana temporal.
- Los reportes originales y sus autores se conservan; el incidente tiene un chat común y un único aporte al cálculo, evitando contar cada aporte como un nuevo hecho.
- Antes de evaluación humana, si los aportes tienen gravedades distintas, se utiliza la mayor.
- La evaluación del agente prevalece; nuevos reportes no reemplazan automáticamente su gravedad corregida.
- Un nuevo reporte agrupado cuenta como confirmación si su autor todavía no había confirmado ese incidente.
- Cada persona puede confirmar una sola vez y debe estar dentro de 50 metros.
- Tres confirmaciones de usuarios validan completamente; una de un agente autorizado basta.
- El peso aumenta gradualmente desde el 50 %.
- Si se vuelve a reportar un problema persistente fuera de la ventana, por ejemplo un bache al día siguiente, se publica y se avisa a un agente para que revise el posible duplicado.

**Criterio de cálculo derivado del aumento gradual:** con 0, 1, 2 y 3 confirmaciones, utilizar 50 %, 66,666… %, 83,333… % y 100 %. Conservar precisión interna y redondear solo para mostrar.

**Pendiente:** precisar si el primer autor puede confirmar su propio incidente y cómo elegir el tramo principal cuando los reportes agrupados estén en tramos diferentes.

## 5. Revisión, resolución y conversación

**Acordado**

- La IA evalúa inicialmente el reporte y su gravedad. Un agente puede corregirla.
- Si la IA sospecha falsedad, genera una alerta para revisión humana.
- El reporte permanece visible mientras dura la investigación; la sospecha automática no equivale a una declaración definitiva de falsedad.
- El usuario puede solicitar revisión de una decisión.
- Cinco usuarios distintos dentro del radio de 50 metros pueden marcar el incidente como resuelto y retirarlo del mapa.
- Un agente autorizado puede resolverlo directamente.
- Se permite reabrir un incidente resuelto.
- Los usuarios pueden indicar que no encontraron el incidente, que está resuelto o que consideran que es falso, añadiendo un detalle del motivo.
- Los chats utilizan nicknames. Para participar se requiere registro y teléfono verificado.
- El chat comunitario se cierra al finalizar el incidente; los delitos individuales tienen la ventana especial de siete días.
- No se realizará moderación general de conversaciones, pero sí control de spam.
- Los reportes se conservan en la base con sus estados y decisiones; retirarlos del mapa no equivale a borrarlos.

**Pendiente:** quién puede reabrir, pruebas para hacerlo, reapertura del chat, tratamiento numérico de una investigación pendiente, método de detección de spam y qué partes del adjunto examina la IA. El propietario indicó que la IA analizará el reporte inicialmente, pero no precisó una integración multimodal ni revisión automática de chats.

## 6. Gravedad, puntos y nivel de tramo

### 6.1 Conceptos separados

**Acordado**

1. Gravedad del incidente: evaluación del hecho, revisable por un agente.
2. Puntos efectivos del incidente: gravedad ajustada por validación y antigüedad aplicable.
3. Nivel del tramo: clasificación del total acumulado de puntos en ese segmento entre intersecciones.

La gravedad se usa directamente como puntos base. Un incidente de gravedad 4 tiene **4 puntos base**, no 24. Las tablas anteriores de conversión de gravedad a 2/6/12/24/60 puntos quedaron descartadas.

Las confirmaciones modifican el peso de validación; no aumentan la gravedad automáticamente.

### 6.2 Aporte y propagación

Para un incidente publicado y computable:

`aporte = gravedad × factor_validacion × factor_antiguedad_aplicable`

- Los puntos del tramo se obtienen sumando los incidentes distintos que le corresponden y la influencia acordada de los tramos conectados.
- Los tramos que intersectan con el afectado reciben el 15 % de su aporte efectivo.
- La proximidad se determina por conexiones de la red vial, no por un círculo indiscriminado ni por toda una avenida con el mismo nombre.
- La influencia vecina se aplica una sola vez, sin propagación recursiva de vecino a vecino.
- Los incidentes agrupados aportan una sola vez.
- Un evento retirado por falsedad, falta de pruebas o finalización sin efecto histórico deja de aportar puntos, aunque su registro siga existiendo.
- No está acordado multiplicar el puntaje del tramo por la credibilidad personal del autor. La reputación y los puntos de usuario son conceptos separados del riesgo vial.

### 6.3 Niveles del tramo

| Puntos acumulados | Nivel | Nombre | Color acordado |
| --- | --- | --- | --- |
| 0 | 0 | Seguro | Verde, #22C55E |
| Mayor que 0 y hasta 5 | 1 | Riesgo bajo | Verde lima, #84CC16 |
| Mayor que 5 y hasta 10 | 2 | Precaución | Amarillo verdoso, #A3E635 |
| Mayor que 10 y hasta 15 | 3 | Riesgo medio | Amarillo, #EAB308 |
| Mayor que 15 y hasta 20 | 4 | Inseguro | Naranja, #F97316 |
| Mayor que 20 | 5 | Crítico | Rojo, #DC2626 |

- No redondear antes de clasificar: 5 pertenece al nivel 1; 5,1 al nivel 2; 20 al nivel 4; 20,1 al nivel 5.
- El nivel 5 es el máximo, aunque sigan acumulándose puntos.
- «Seguro» es la etiqueta acordada para cero puntos registrados dentro de cobertura; el indicador no constituye una probabilidad estadística de sufrir un incidente.
- Ejemplo: robo de gravedad 4 reciente sin validar = 2 puntos; validado = 4 puntos; dos robos distintos recientes y validados = 8 puntos, nivel 2 del tramo.

### 6.4 Antigüedad histórica

| Antigüedad desde el hecho | Peso |
| --- | --- |
| Hasta 3 meses | 100 % |
| Más de 3 y hasta 6 meses | 75 % |
| Más de 6 meses y hasta 1 año | 50 % |
| Más de 1 y hasta 2 años | 25 % |
| Más de 2 y hasta 3 años | 10 % |
| Más de 3 años | 0 %; fuera del mapa histórico |

- Generan antecedentes históricos: robo, hurto, intento de robo, amenazas, extorsión y persona desaparecida.
- Un incendio extinguido no conserva por sí mismo riesgo histórico. Una consecuencia persistente, como una estructura dañada, se registra/evalúa como tal.
- Bache, mala iluminación y basura acumulada requieren seguimiento y verificación presencial de agentes. No dar por resuelto un problema persistente solo porque transcurrió tiempo.
- Los agentes y administradores necesitan identificar estos problemas y asignar su revisión.

**Pendiente:** tratamiento exacto de antigüedad de problemas persistentes todavía abiertos y resolución de fronteras de fechas a nivel de horas/calendario al implementar.

## 7. Rutas y navegación

### 7.1 Comportamiento acordado

- Modos: caminar, bicicleta y automóvil.
- Alternativas: más corta, más segura y equilibrio entre ambas.
- Si las alternativas coinciden, mostrar una sola en lugar de duplicados.
- Los puntos se asignan a tramos entre intersecciones, no a toda una avenida.
- Si aparece un incidente importante sobre el recorrido, avisar y preguntar si el usuario desea cambiar la ruta.
- Frente a un incidente muy grave, como un disturbio activo, comunicar la situación y dejar la decisión al usuario. No cambiar automáticamente su recorrido por el riesgo ciudadano.
- Avisos durante el recorrido en la web; no se ha pedido seguimiento continuo con la web cerrada.
- Permitir rutas favoritas, historial y consulta de recorridos previamente cargados.
- Publicidad solo durante el recorrido elegido; no modifica el trazado ni el puntaje de seguridad.
- Fuera de cobertura, avisar que no se dispone de información.

### 7.2 Criterio delegado: medio de transporte

El propietario delegó cómo adaptar la influencia al modo. Diseño inicial:

- Conservar la puntuación general del tramo y evaluar adicionalmente la relevancia del incidente al comparar rutas de cada modo.
- Utilizar redes transitables propias de caminar, bicicleta y automóvil.
- Bicicleta: dar mayor prioridad a evitar baches y obstáculos en la calzada.
- Automóvil: dar mayor prioridad a bloqueos de circulación, accidentes y semáforos dañados.
- Peatón: dar mayor prioridad a condiciones de paso, iluminación cuando corresponda al horario y exposición a incidentes de seguridad.
- Incidentes graves que afectan físicamente al paso, como fuego, gas, inundación o derrumbe: advertir en todos los modos afectados.
- No inventar que una vía físicamente intransitable es una alternativa válida. Diferenciar transitabilidad de la decisión personal ante una advertencia de riesgo.
- Los coeficientes numéricos por tipo/modo y su evaluación con datos quedan pendientes; no atribuir a estas reglas una calibración científica realizada.

Referencia técnica: Mapbox Directions dispone de perfiles walking, cycling y driving. Puede intentar devolver alternativas, pero no garantiza que existan tres recorridos distintos: https://docs.mapbox.com/api/navigation/directions/

### 7.3 Criterio delegado: desvíos

Diseño inicial, configurable:

- Tomar como referencia el tiempo de la alternativa más corta disponible, cuya selección primaria se hace por distancia.
- Para la ruta intermedia, buscar hasta un 25 % de tiempo adicional.
- Para la ruta más segura, buscar hasta un 50 % de tiempo adicional.
- Son límites iniciales de recomendación, no límites de las decisiones del usuario. Si una alternativa que reduce la exposición requiere más tiempo, informar el costo y permitir que el usuario amplíe la búsqueda.
- Mostrar siempre distancia y tiempo estimado para comparar. No prometer ausencia de incidentes.
- Ejemplo: con una referencia de 20 minutos, buscar inicialmente una intermedia de hasta 25 minutos y una más segura de hasta 30 minutos.

**Pendiente:** alcance exacto del material disponible sin internet (geometría, instrucciones y mapas), actualización de favoritos, caducidad de datos almacenados y cuantificación del riesgo de un recorrido completo. Las condiciones actuales no pueden darse por actualizadas cuando se consulta una copia guardada.

## 8. Credibilidad, participación y recompensas

### 8.1 Credibilidad

**Acordado**

- Inicialmente «sin definir».
- A partir del tercer reporte validado se asigna una credibilidad inicial de 100 y se desbloquea la primera insignia.
- Un reporte declarado falso después de revisión reduce la credibilidad.
- Secuencia confirmada: **100 → 70 → 40 → 20 → bloqueo en la cuarta falta**.
- El usuario puede pedir revisión; una sospecha de IA no cuenta por sí sola como falta confirmada.
- Habrá otras insignias, todavía sin nombres ni requisitos definidos.

**Pendiente:** contabilización de faltas antes de alcanzar tres reportes validados, rehabilitación de credibilidad y duración/reversión del bloqueo tras una apelación.

### 8.2 Puntos mensuales y ranking

**Acordado**

- El ranking usa puntos obtenidos durante el mes, no la credibilidad histórica acumulada.
- Se obtienen por incidentes validados, confirmaciones y aportación de pruebas.
- Los primeros tres autores de un incidente agrupado reciben, respectivamente, 100 %, 75 % y 50 % de los puntos de participación correspondientes.
- Las insignias, puntos de usuario y monedas son distintos del puntaje de riesgo del tramo.
- Los diez primeros del ranking reciben monedas acumulables.
- En caso de empate se suman los premios de las posiciones involucradas y se dividen entre los participantes empatados.
- La retirada de puntos/monedas por falsedad posterior se decide previa evaluación del administrador.

**Pendiente:** puntos base por cada acción, condiciones para premiar confirmaciones/pruebas, tratamiento de autores posteriores al tercero, premios por posición, precisión fraccionaria de monedas y empates que cruzan el décimo puesto.

### 8.3 Canjes

- Las monedas permanecen acumuladas y el usuario decide cuándo canjearlas.
- Se prevén productos y cupones; todavía no hay un catálogo real disponible.
- Publicidad y convenios buscan financiar los premios.
- La primera versión será una demostración; no debe registrar una entrega o cobro real cuando solo se simula.

**Pendiente:** inventario, costos en monedas, flujo de solicitud/aprobación/entrega y tratamiento de falta de stock.

## 9. Publicidad y Premium

### 9.1 Publicidad

**Acordado**

- Los administradores registran inicialmente los negocios y sus anuncios.
- Modelo futuro de ingresos: visualizaciones y convenios con negocios.
- Durante un recorrido, al pasar a 50 metros de un negocio participante puede aparecer una tarjeta pequeña.
- Las tarjetas aparecen en función del avance del recorrido, no con un límite de una por viaje.
- Desaparecen a los pocos segundos.
- Un mismo negocio no se repite durante el mismo recorrido.
- Una visualización cuenta cuando aparece la tarjeta.
- Al pulsarla se abre una ficha del negocio.
- Habrá además un recuadro pequeño de publicidad en la página.
- En la demostración no se implementan pagos reales.

**Pendiente:** separación mínima entre tarjetas, duración exacta, selección entre negocios simultáneos, contenido de ficha, ubicación del recuadro fijo y métricas visibles para los anunciantes. El umbral de 50 metros se interpreta como proximidad al negocio; no resuelve el intervalo entre dos anuncios distintos.

### 9.2 Premium: propuesta aceptada provisionalmente

El propietario aceptó por el momento la propuesta presentada:

- Precio de referencia: S/5,90 mensuales, sin cobro durante la demostración.
- Opción de desactivar recomendaciones comerciales durante el recorrido y ocultar el recuadro publicitario.
- Gratis: hasta tres rutas favoritas. Premium: hasta veinte, con nombres y etiquetas.
- Gratis: consulta del último recorrido previamente cargado. Premium: varios recorridos guardados.
- Historial básico para todos; filtros y estadísticas personales adicionales para Premium.
- Reportes, confirmaciones, chats, alternativas de ruta y avisos de incidentes disponibles también en el plan gratuito.
- Misma información y mismo cálculo de seguridad para ambos planes.
- Premium no mejora la credibilidad ni otorga ventaja en el ranking.
- El administrador puede activar Premium en cuentas de prueba, indicándolo como demostración.

**Pendiente:** cantidad exacta de recorridos almacenables en Premium, definición de estadísticas y detalle de un futuro ciclo de suscripción real.

## 10. Asistente e información externa

- El chatbot debe ayudar a usar CiviGo, consultar incidentes, preparar reportes y orientar sobre rutas.
- Los proveedores de IA y verificación telefónica todavía no están elegidos.
- Se prevé incorporar antecedentes de DATACRIM y otras fuentes públicas; todavía no hay archivos ni enlaces concretos seleccionados.
- Mantener diferenciados los antecedentes importados, los reportes ciudadanos y las decisiones de agentes. No presentar como actual un evento histórico importado.
- La precisión geográfica disponible debe determinar si un dato puede asignarse a un tramo; no convertir automáticamente una estadística distrital en un punto exacto.

## 11. Pendientes de implementación frente al código actual

La revisión previa del repositorio encontró un prototipo: mapa, formulario y API de reportes/incidentes, registro básico y modelos Prisma. Los siguientes puntos son trabajos futuros, no funcionalidades ya verificadas:

- Autenticación, verificación de teléfono/correo y permisos.
- Formularios por categorías con las reglas de este documento.
- Separación de delitos individuales e incidentes comunitarios.
- Confirmaciones únicas por usuario, resolución, revisiones y chats.
- Tramos viales, puntuación contextual y rutas.
- IA, archivos privados, tareas de recordatorio y expiración.
- Credibilidad, ranking, monedas y canjes de demostración.
- Publicidad y Premium de demostración.
- Configuración y validación del despliegue.

No reutilizar sin revisión las reglas antiguas del prototipo: usuario fijo en el formulario, agrupación a 100 metros, incremento de gravedad por confirmación, escala anterior de colores y confusión de identificadores de reporte/incidente.

## 12. Parámetros que deben poder ajustarse

Separar el concepto de regla de su valor inicial y conservar trazabilidad de cambios:

- Catálogo, categorías, urgencia, requisitos de evidencia y elegibilidad histórica.
- Radio de GPS corregible y confirmación: 50 metros.
- Agrupación comunitaria: 50 metros y tres horas.
- Validación comunitaria: tres usuarios o un agente.
- Resolución: cinco usuarios cercanos o un agente autorizado.
- Peso inicial: 50 %; influencia en tramos conectados: 15 %.
- Cortes por tramo: 0, 5, 10, 15 y 20; máximo nivel 5.
- Depreciación histórica: 100/75/50/25/10/0 % según antigüedad.
- Plazos de pruebas: uno, tres y siete días desde la publicación.
- Adjuntos: máximo tres; antigüedad ciudadana máxima: una semana.
- Penalizaciones de credibilidad y bloqueo en cuarta falta.
- Puntos mensuales, insignias, premios y monedas, cuando se definan.
- Anuncios a 50 metros; frecuencia y duración todavía pendientes.
- Preferencias por transporte y límites iniciales de desvío de 25 % y 50 % como criterio delegado.

Los parámetros pendientes permanecen sin valor definitivo. Ningún cambio en este documento equivale a una migración, un despliegue o una aprobación de gasto.
