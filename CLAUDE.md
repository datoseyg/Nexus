# EYG Nexus Local -Instrucciones para Claude

## Rol del proyecto

Este proyecto implementa un pipeline local/serverless-first para integrar datos de EYG desde tres plataformas:

1. Zendesk
2. FieldBeat
3. Dolibarr

El objetivo es construir una arquitectura de datos extensible, migrable y de costo cero en Fase 1, evitando depender de servidores físicos o costos variables. El sistema debe poder correr localmente en VS Code y luego migrar orgánicamente a nube/serverless.

## Contexto arquitectónico

Este proyecto viene de una integración anterior llamada Proyecto 6, donde existían hojas planas:

- DB_Tickets_Zendesk
- Reporte_Tickets_Detallado
- FieldBeat-Zendesk

La evolución actual busca convertir esa integración plana en una arquitectura normalizada:

- RAW JSON local
- tablas normalizadas
- dimensiones
- tablas puente
- tablas GOLD para BI

## Stack actual

- Node.js
- dotenv
- fetch nativo de Node
- archivos JSON RAW en `data/raw`
- VS Code como entorno local
- futura migración posible a Google Apps Script, GitHub Actions, Cloud Run, Cloudflare Workers o arquitectura serverless equivalente

## Estructura esperada

```text
eyg-nexus-local/
├─ .env
├─ .env.example
├─ .gitignore
├─ package.json
├─ data/
│  ├─ input/
│  └─ raw/
│     ├─ zendesk/
│     ├─ fieldbeat/
│     └─ dolibarr/
└─ src/
   ├─ run-all.js
   ├─ lib/
   │  ├─ http.js
   │  └─ save-json.js
   └─ miners/
      ├─ zendesk.js
      ├─ fieldbeat-all.js
      └─ dolibarr.js
````

## Plataformas

### Zendesk

Zendesk se consulta con Basic Auth:

* username: `${ZENDESK_USER}/token`
* password: `${ZENDESK_TOKEN}`

Endpoint principal:

```text
GET /api/v2/search.json?query=type:ticket order_by:updated_at sort:asc
```

Debe guardar RAW en:

```text
data/raw/zendesk/
```

### FieldBeat

FieldBeat se consulta con Basic Auth:

* username: `FIELDBEAT_API_USER`
* password: `FIELDBEAT_API_PASS`

Endpoint principal:

```text
GET https://api.fieldbeat.com/fleets/eyg/tasks
```

La paginación NO usa `page=1`.

La API usa cursor:

```text
GET /tasks
→ respuesta trae next_page
→ GET /tasks?next_page=<cursor>
→ repetir hasta que no exista next_page
```

No usar `limit=10&page=1`, porque eso provoca error de servidor.

Debe guardar RAW en:

```text
data/raw/fieldbeat/list_pages/
data/raw/fieldbeat/all_tasks_latest.json
data/raw/fieldbeat/task_index.json
```

### Dolibarr

Dolibarr se consulta con header:

```text
DOLAPIKEY: ${DOLIBARR_TOKEN}
```

Endpoint esperado:

```text
GET /api/index.php/products?limit=100&page=0
```

Debe guardar RAW en:

```text
data/raw/dolibarr/
```

## Reglas de seguridad

Nunca escribir tokens reales en archivos versionados.

Nunca modificar `.env` para incluir valores reales visibles.

Si se necesita documentar variables, crear o editar `.env.example`.

`.gitignore` debe excluir:

```text
.env
data/raw/
node_modules/
```

Si encuentras tokens reales en código, debes advertirlo y proponer rotación.

## Objetivo técnico inmediato

El objetivo inmediato es dejar funcionando los miners locales:

```bash
npm run get:zendesk
npm run get:fieldbeat:all
npm run get:dolibarr
npm run get:all
```

El miner de FieldBeat debe usar `next_page` como cursor.

## Filosofía de trabajo

No hacer cambios gigantes sin plan.

Antes de editar varios archivos, primero explicar brevemente:

1. Qué detectaste.
2. Qué vas a cambiar.
3. Qué archivos vas a tocar.
4. Cómo se prueba.

Después de editar, indicar:

1. Qué cambió.
2. Qué comando ejecutar.
3. Qué resultado esperar.

## Restricciones

* Mantener arquitectura portable.
* Evitar dependencias innecesarias.
* No introducir servidores físicos.
* No asumir costos cloud.
* No romper compatibilidad con una futura migración serverless.
* Priorizar código claro, modular y trazable.

## Comandos útiles

```bash
npm install
npm run get:zendesk
npm run get:fieldbeat:all
npm run get:dolibarr
npm run get:all
```

## Estado actual conocido

El endpoint de FieldBeat `/tasks` devuelve:

* `status_code`
* `count`
* `next_page`
* `tasks`

La paginación correcta es por cursor `next_page`.

Si el script `npm run get:fieldbeat:all` no imprime nada salvo el comando de Node, revisar que `mineAllFieldBeatTasks()` se esté llamando al final del archivo `src/miners/fieldbeat-all.js`.

## Pendientes conocidos para Fase 2

### Tickets Zendesk inaccesibles por permisos de token (291 IDs)

Al reconciliar el alcance Ticket ↔ FieldBeat ↔ Dolibarr se detectaron 920 relaciones de `BR_Ticket_FieldBeat_Task` que apuntan a un `zendesk_ticket_id` que no existe en los 628 tickets minados. Se corrió un backfill (`npm run get:zendesk:backfill-fieldbeat`) contra los 656 IDs únicos faltantes:

- 4 encontrados (duplicados de tickets ya existentes, no aportaron nada nuevo).
- 361 con 404 genuino (números con forma de basura/typo de técnico, ej. IDs de 12+ dígitos).
- **291 con error 403 Forbidden**, concentrados en dos rangos densos y consecutivos: **5–500** y **~8600–10227**. Este patrón sugiere que son tickets reales existentes en Zendesk, pero el token actual (`ZENDESK_USER`/`ZENDESK_TOKEN` en `.env`) no tiene permiso para verlos vía `/api/v2/tickets/{id}.json` (rol de agente restringido a asignados/seguidos, tickets privados, o de otra marca).

**Estado:** con el token actual no hay nada más que hacer -se ignoran por ahora, no bloquean el mart GOLD.

**Para retomar en Fase 2:** revisar si existe un token con permiso "ver todos los tickets" (rol admin o agente sin restricción) y volver a correr `npm run get:zendesk:backfill-fieldbeat` contra esos 291 IDs específicamente. La lista completa está guardada en `data/reports/zendesk_ticket_ids_not_accessible_403.json`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
