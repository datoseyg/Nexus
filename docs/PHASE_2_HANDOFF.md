# Handoff a Fase 2 - EYG Nexus Local

**Fase 2 debe productivizar Fase 1, no romperla.** Todo lo de acá abajo se construye ENCIMA del pipeline local actual (RAW → PROCESSED → MARTS → GOLD → DuckDB) - ninguno de estos ítems requiere reescribir lo que ya funciona. Ver [PHASE_1_CLOSEOUT.md](PHASE_1_CLOSEOUT.md) para el estado de lo ya cerrado.

## Checklist de Fase 2

1. **Token Zendesk con permiso de ver todos los tickets** (rol admin o agente sin restricción). Es el prerequisito para el punto 2.
2. **Reintentar el backfill de los 291 IDs con `403 Forbidden`** - `npm run get:zendesk:backfill-fieldbeat`, pero apuntando específicamente a la lista en `data/reports/zendesk_ticket_ids_not_accessible_403.json` una vez resuelto el punto 1. Con el token actual esto ya se probó y no recupera nada nuevo - no repetir sin el nuevo token.
3. **Rebuild completo** del pipeline (`npm run get:fieldbeat:all && npm run get:zendesk && ...` - ver [LOCAL_OPERATIONS_RUNBOOK.md](LOCAL_OPERATIONS_RUNBOOK.md)) una vez recuperados los tickets del punto 2, para que el universo ticket-céntrico crezca más allá de los 628 actuales.
4. **Automatización serverless** - migrar los miners/normalizers/marts/gold a un runner programado (GitHub Actions con cron, Cloud Run, Cloudflare Workers, o Google Apps Script si se prefiere mantener el ecosistema de Proyecto 4). La arquitectura actual ya está diseñada para esto (cada etapa lee/escribe archivos, sin estado compartido en memoria) - ver [ARCHITECTURE.md](ARCHITECTURE.md).
5. **Secret Manager** - mover `ZENDESK_TOKEN`, `FIELDBEAT_API_PASS`, `DOLIBARR_TOKEN` de `.env` local a un gestor de secretos (Google Secret Manager, AWS Secrets Manager, etc.) antes de correr en cualquier entorno compartido/cloud.
6. **Cloud Storage / BigQuery** - reemplazar `data/raw/`, `data/processed/`, `data/marts/`, `data/gold/` por un bucket + BigQuery (o equivalente) si el volumen de datos o la necesidad de acceso concurrente lo justifica. DuckDB puede seguir siendo la capa de consulta local incluso si el storage subyacente cambia.
7. **Looker Studio / Power BI** - conectar un dashboard real a las tablas mapeadas en [BI_READINESS.md](BI_READINESS.md). Ninguna tabla GOLD necesita cambios para esto, solo hace falta decidir la herramienta y el método de conexión (directo a DuckDB, o vía exportación a Sheets/BigQuery).
8. **Cargas incrementales** - hoy cada miner re-descarga todo el histórico disponible en cada corrida (`CREATE OR REPLACE`, reconstrucción completa). Para volúmenes más grandes, evaluar cargas incrementales (solo lo nuevo/modificado desde la última corrida) en miners y en `db:load`.
9. **Observabilidad/logging** - hoy la única señal de éxito/falla es la salida de consola y los JSON de resumen (`data/reports/*.json`). Para producción, agregar logging estructurado y alertas (ej. si `db:validate` falla, o si el `match_rate` de repuestos cae debajo de un umbral).
10. **Flujo de alias manuales para repuestos/clientes/equipos** - hoy existe `data/config/part_identity_aliases.csv` para repuestos (ver `docs/QUERY_GUIDE.md` y `sql/07_unmatched_and_ambiguous_parts.sql` para cómo priorizar qué agregar). Falta un mecanismo equivalente para normalizar nombres de cliente/equipo si aparecen variantes (hoy se asume que `client_key`/`equipment_internal_id` ya son estables).
11. **Eventual automatización de movimientos de stock en Dolibarr, con controles** - explícitamente fuera de alcance en Fase 1 y en este handoff no se recomienda activarlo sin diseño previo: requiere reglas de bodega, protocolo de reversa ante errores, y un umbral de confianza mínimo sobre el matching (`match_status = MATCHED` con `match_confidence` alto) antes de tocar inventario real. Ver `docs/Documentación Proyecto 4.md` para cómo el sistema anterior (Google Apps Script) resolvía esto, como referencia de diseño - no como algo a portar directo.

## Qué NO hacer al empezar Fase 2

- No reemplazar los marts/GOLD ticket-céntricos por los report-céntricos (o viceversa) - son complementarios, ambos siguen siendo necesarios.
- No activar movimientos de stock antes de tener un diseño explícito y revisado (punto 11).
- No mover secretos a un Secret Manager sin antes rotar los tokens actuales si hay alguna sospecha de exposición.
- No borrar `data/raw/` histórico al migrar a cloud storage - es la fuente de verdad si algo sale mal en la migración.
