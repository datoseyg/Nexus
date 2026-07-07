# Limitaciones conocidas - Fase 1

Todo lo que Fase 1 **no** resuelve todavía, documentado explícitamente para que nadie lo confunda con un bug no detectado. Ninguno de estos puntos bloquea el uso de Fase 1 como MVP local - son alcance conocido y aceptado.

## 1. 291 tickets Zendesk con `403 Forbidden`

El token Zendesk actual no tiene permiso para leer 291 ticket IDs referenciados por FieldBeat, vía `GET /api/v2/tickets/{id}.json`. El patrón de IDs (concentrados en rangos densos 5–500 y ~8600–10227) sugiere que son tickets reales, no basura de datos - probablemente un rol de agente restringido a tickets asignados/seguidos.

- Lista completa: `data/reports/zendesk_ticket_ids_not_accessible_403.json`.
- **No bloquea Fase 1.** Requiere un token con permisos ampliados - queda para Fase 2 (ver [PHASE_2_HANDOFF.md](PHASE_2_HANDOFF.md)). **No reintentar el backfill con el token actual** - ya se probó y no recupera nada nuevo (ver [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md)).

## 2. 920 relaciones FieldBeat hacia tickets faltantes/restringidos

De 1210 relaciones FieldBeat→Zendesk (`BR_Ticket_FieldBeat_Task.csv`), solo 290 apuntan a un ticket que existe en los 628 minados. Las otras 920 apuntan a un `zendesk_ticket_id` que no existe o no es accesible ("ticket fantasma", typo del técnico, o ticket fuera del rango minado).

## 3. 2537 reportes FieldBeat sin ticket reportado

De 3747 tasks FieldBeat totales, 2537 (68%) nunca tuvieron un número de ticket escrito en el reporte técnico - problema de captura de datos histórico, no del pipeline actual.

## 4. Columnas de porcentaje son texto, no numéricas

Columnas como `*_rate`, `percent_of_total_*` en las tablas GOLD vienen como `VARCHAR` con el símbolo `%` incluido (ej. `"42.27%"`), generadas ya formateadas desde JS. Para sumarlas/promediarlas en SQL hay que parsear el `%` primero (`TRY_CAST(REPLACE(columna, '%', '') AS DOUBLE)`).

## 5. `read_csv_auto` puede inferir tipos distintos entre corridas

DuckDB infiere el tipo SQL de cada columna a partir del contenido real del CSV en el momento de la carga. Si los datos cambian (ej. aparece el primer caso de un repuesto con múltiples productos matcheados donde antes nunca hubo ninguno), el tipo de esa columna puede cambiar de `BIGINT` a `VARCHAR` en el próximo `db:load` - no hay un schema SQL fijo/manual. Ver casos reales documentados en [DATA_DICTIONARY.md](DATA_DICTIONARY.md), sección "Anomalías y advertencias de tipos".

## 6. Columnas vestigiales en `processed.fieldbeat_used_parts`

`dolibarr_product_id`, `dolibarr_ref`, `unit_cost`, `estimated_total_cost` en esa tabla son del diseño original, previo a construir el resolver de identidad de repuestos (`dolibarr_ref` ahí es literalmente una copia de `part_number`, la asunción ingenua que resultó incorrecta). **La fuente real de verdad del matching es `marts.used_parts_dolibarr_match`** - no usar las columnas de `processed.fieldbeat_used_parts` para nada relacionado a qué producto Dolibarr corresponde un repuesto.

## 7. `barcode` de Dolibarr inferido como `BIGINT`

Solo 1 de 1609 productos Dolibarr tiene barcode cargado, y ese único valor es puramente numérico - por eso DuckDB infiere `BIGINT` en vez de `VARCHAR`. Si en el futuro aparece un barcode con letras o ceros a la izquierda significativos, el tipo cambiaría solo en el próximo rebuild, y cualquier comparación que asuma "es numérico" podría romperse.

## 8. No hay movimientos de stock automáticos

`Used_Parts_Dolibarr_Match.csv` (y por lo tanto todo lo que se construye sobre ella) **solo identifica** qué producto Dolibarr corresponde a cada repuesto usado - no descuenta inventario ni genera ningún movimiento de stock. Esto fue una restricción explícita en toda la construcción de Fase 1, no un olvido. Ver punto 11 de [PHASE_2_HANDOFF.md](PHASE_2_HANDOFF.md) si se decide automatizarlo eventualmente.
