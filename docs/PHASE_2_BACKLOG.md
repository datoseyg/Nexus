# Backlog — Fase 2

Pendientes identificados durante la construcción de GOLD v1. Ninguno bloquea el uso de GOLD v1 tal como está — son mejoras de alcance, infraestructura y proceso para una siguiente iteración.

## 1. Revisar los 291 tickets Zendesk con 403 Forbidden

**Qué:** con el token Zendesk actual, 291 `zendesk_ticket_id` referenciados por FieldBeat devuelven `403 Forbidden` al consultarlos directo (`GET /api/v2/tickets/{id}.json`), en vez de 404. El patrón de IDs (concentrados en los rangos 5–500 y ~8600–10227) sugiere que son tickets reales, no basura de datos.

**Acción:** conseguir/usar un token Zendesk con permisos ampliados (rol admin o agente sin restricción de "ver todos los tickets") y volver a correr `npm run get:zendesk:backfill-fieldbeat` contra esos 291 IDs específicos.

**Referencia:** `data/reports/zendesk_ticket_ids_not_accessible_403.json` (lista completa de los 291 IDs).

**Impacto esperado:** si se recuperan, aumentaría `used_parts_in_ticket_mart` (hoy 200) y `total_zendesk_tickets` (hoy 628), reduciendo `fieldbeat_tasks_linked_to_missing_zendesk_ticket` (hoy 920).

## 2. Migración serverless

**Qué:** el pipeline hoy corre 100% local (VS Code + Node.js). La arquitectura ya está diseñada para migrar sin rediseño (cada etapa es RAW → PROCESSED → MARTS → GOLD vía archivos, sin estado compartido en memoria) — ver [ARCHITECTURE.md](ARCHITECTURE.md).

**Acción:** evaluar destino (Google Apps Script, GitHub Actions con cron, Cloud Run, Cloudflare Workers) y reemplazar lectura/escritura de archivo local por lectura/escritura de storage (bucket, Sheets, etc.) sin tocar la lógica de negocio de normalizers/resolvers/marts.

## 3. Publicación BI automatizada

**Qué:** hoy `data/gold/*.csv` se genera localmente y se conecta manualmente a una herramienta BI.

**Acción:** definir destino de publicación automática (Looker Studio vía Google Sheets/BigQuery, Power BI, Metabase) y agregar un paso final al pipeline que suba los CSV de `data/gold/` tras cada `npm run build:gold`.

## 4. Automatización de movimientos de stock (pendiente de decisión)

**Qué:** el pipeline actual **no crea movimientos de stock en Dolibarr** — `Used_Parts_Dolibarr_Match.csv` solo identifica qué producto corresponde a cada repuesto usado, no descuenta inventario. Esto fue una restricción explícita en todas las fases de construcción de GOLD v1.

**Acción (si se decide seguir adelante):** evaluar si automatizar la salida de stock en Dolibarr a partir de `Used_Parts_Dolibarr_Match.csv` (filtrando por `match_status = MATCHED` y confianza alta) es deseable, y diseñarlo como una etapa nueva y explícita — no una extensión silenciosa del resolver de identidad. Requiere definir reglas de bodega (ver `docs/Documentación Proyecto 4.md`, que documenta cómo P4 resolvía esto en Google Apps Script) y protocolo de reversa ante errores.

## Notas de proceso

- Todo el histórico de decisiones y números reales de esta fase (Sprint 1 a GOLD v1) quedó en la conversación que originó esta documentación — este backlog resume solo lo accionable, no repite el detalle completo.
- Antes de tomar cualquier ítem de este backlog, releer [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md) para no perder de vista qué universo cubre GOLD v1 hoy.
