# Mapa de estructura del proyecto

Explica, carpeta por carpeta, para qué sirve, si contiene fuente o generado, si debe versionarse, quién la usa y advertencias. Es el documento "de entrada" para orientarse en la estructura física del repo — para el detalle archivo por archivo ver [PROJECT_FILE_INVENTORY.md](PROJECT_FILE_INVENTORY.md); para el flujo de datos entre etapas ver [DATA_PIPELINE_MAP.md](DATA_PIPELINE_MAP.md).

Generado a mano como parte de la auditoría de estructura del 2026-07-04 (ver `PROJECT_INDEX.md` en la raíz). Puede regenerarse/verificarse corriendo `npm run audit:structure`.

---

## `/` (raíz)

**Propósito:** raíz del proyecto ETL local. Contiene `package.json` (scripts globales del pipeline), configuración de entorno, y la documentación principal (`CLAUDE.md`).

**Fuente o generado:** mixto - `package.json`/`.gitignore`/`CLAUDE.md` son fuente (hecha a mano); `package-lock.json` es generado por `npm install`.

**¿Versionar?** Sí, todo excepto lo listado en `.gitignore`.

**Quién la usa:** cualquier comando `npm run ...` se ejecuta desde acá.

**Advertencias:**
- `README.md` está prácticamente vacío (`# Nexus`, 1 línea) - **no describe el proyecto**. `CLAUDE.md` y `PROJECT_INDEX.md` son los documentos reales de orientación.
- `./nodenpm` es un archivo de 0 bytes en la raíz, sin ninguna referencia en el código - ver [PROJECT_CLEANUP_CANDIDATES.md](PROJECT_CLEANUP_CANDIDATES.md).
- `.env` existe localmente (no versionado) - nunca debe commitearse ni citarse su contenido.

---

## `src/`

**Propósito:** toda la lógica del pipeline local (extracción, normalización, resolución, marts, GOLD, QA, warehouse, curación).

**Fuente o generado:** 100% fuente (código escrito a mano).

**¿Versionar?** Sí, completo.

**Quién la usa:** se invoca vía scripts de `package.json` (`npm run get:...`, `normalize:...`, `build:...`, `qa:...`, `db:...`).

### `src/miners/`
**Propósito:** extracción (RAW) desde las 3 APIs externas (Zendesk, FieldBeat, Dolibarr) + un backfill puntual.
**Fuente/generado:** fuente. **Versionar:** sí.
**Advertencias:**
- `fieldbeat.js` (el miner puntual por `FIELDBEAT_TASK_IDS`, script `get:fieldbeat`) parece tener un bug: usa una variable `taskId` que nunca se declara (solo existe `taskIds`, el array) y nunca itera sobre la lista de IDs - correrlo probablemente lanza `ReferenceError`. Ver [PROJECT_CLEANUP_CANDIDATES.md](PROJECT_CLEANUP_CANDIDATES.md).
- `.prettierrc` vive dentro de esta carpeta en vez de en la raíz del proyecto - ubicación inusual, solo afecta el formateo de `src/miners/` en editores que buscan el archivo más cercano.
- El miner real usado en el flujo completo es `fieldbeat-all.js` (`get:fieldbeat:all`, paginación por cursor `next_page`) - ver `CLAUDE.md`.

### `src/normalizers/`
**Propósito:** transforma RAW (JSON) → PROCESSED (CSV normalizado, una tabla por entidad).
**Fuente/generado:** fuente. **Versionar:** sí.
**Advertencia:** `fieldbeat-normalizer.js` reimplementa `csvEscape`/`writeCsv`/`ensureDir` localmente en vez de importar `src/lib/csv.js` (a diferencia de `zendesk-normalizer.js` y `dolibarr-normalizer.js`, que sí importan) - funciona igual, pero es una duplicación de código evitable.

### `src/resolvers/`
**Propósito:** lógica de resolución de identidad - hoy solo repuestos FieldBeat ↔ Dolibarr (`part-identity-resolver.js`), cascada REF/BARCODE/ID exacto → normalizado → `REF_LIKE` → alias manual → placeholder.
**Fuente/generado:** fuente. **Versionar:** sí. **Crítico:** sí - lo consumen `src/marts/build-used-parts-dolibarr-match.js` y `src/normalizers/dolibarr-normalizer.js`.

### `src/marts/`
**Propósito:** construye vistas intermedias de negocio (cruces entre plataformas) - hay 3 líneas: ticket-céntrica, report-céntrica/FieldBeat-first, y after-hours.
**Fuente/generado:** fuente. **Versionar:** sí.

### `src/gold/`
**Propósito:** construye los datasets finales agregados para BI (3 builders: ticket-céntrico, FieldBeat-first, after-hours).
**Fuente/generado:** fuente. **Versionar:** sí.

### `src/db/`
**Propósito:** inicializa/carga/valida el warehouse DuckDB (`data/warehouse/eyg_nexus.duckdb`) a partir de los CSV de `data/processed/marts/gold`. `warehouse-config.js` es la lista maestra de tablas (única fuente de verdad de qué se carga).
**Fuente/generado:** fuente. **Versionar:** sí. **Crítico:** sí - `warehouse-config.js` es el punto de wiring que hay que tocar para registrar cualquier tabla nueva.

### `src/qa/`
**Propósito:** validaciones y auditorías - una por plataforma normalizada (`audit-fieldbeat/zendesk/dolibarr.js`), una de multiplicidad ticket↔FieldBeat, una de reconciliación de alcance, y la auditoría final de cierre de Fase 1 (`final-phase1-audit.js`).
**Fuente/generado:** fuente. **Versionar:** sí.

### `src/curation/`
**Propósito:** valida que los CSV de `data/curation/` (modelo de corrección manual, aún no conectado a un flujo de escritura real) tengan el schema esperado.
**Fuente/generado:** fuente. **Versionar:** sí.
**Advertencia:** el modelo de curación está documentado (`docs/CURATION_MODEL.md`) y validado, pero **no está conectado** a ningún flujo de escritura desde la app ni a los normalizers/resolvers - solo existen los `.example.csv`.

### `src/lib/`
**Propósito:** helpers compartidos por todo el pipeline: `csv.js` (leer/escribir CSV), `http.js` (fetch + basic auth), `save-json.js` (guardar RAW), `business-hours.js` y `calculation-confidence.js` (modelo de horario/confiabilidad de la vista Trabajo Fuera de Horario).
**Fuente/generado:** fuente. **Versionar:** sí. **Crítico:** sí - `csv.js` lo importa casi todo el pipeline.

### `src/pipeline/`, `src/cloud/`
**No existen todavía.** El TL;DR del proyecto los menciona como futuros ("futura sincronización", "posible cloud smoke test"), pero no hay directorio ni código bajo esos nombres hoy - lo más cercano documentado es la Pantalla 9 "Administración del Pipeline" en `docs/APP_UI_SPEC.md` (especificación, no implementación) y la sección de migración a Cloudflare en `docs/PRODUCT_APP_ARCHITECTURE.md`.

### `src/run-all.js`, `src/request.http`
`run-all.js` orquesta los 3 miners en secuencia (script `get:all`) - fuente, versionar, sí. `request.http` **no es un archivo de requests HTTP** pese a su extensión: contiene código JS casi idéntico a `run-all.js` pero con el miner FieldBeat viejo (`fieldbeat.js` en vez de `fieldbeat-all.js`) - parece una copia vieja guardada con el nombre/extensión equivocados. Cero referencias en el resto del código. Ver [PROJECT_CLEANUP_CANDIDATES.md](PROJECT_CLEANUP_CANDIDATES.md).

---

## `apps/nexus-bi-app/`

**Propósito:** app web local (Next.js/React), solo lectura, para usuarios no técnicos - dashboards, explorador, búsqueda, auditoría, y Trabajo Fuera de Horario. Ver [APP_STRUCTURE_MAP.md](APP_STRUCTURE_MAP.md) para el detalle ruta por ruta.

**Fuente/generado:** fuente (excepto `.next/`, `node_modules/`, generados por herramientas - ya excluidos del escaneo).

**¿Versionar?** Sí el código; `package-lock.json` propio sí se versiona (es un proyecto Next.js independiente, con su propio lockfile - **no** es un paquete de un monorepo/workspace, `next.config.ts` lo aísla deliberadamente vía `turbopack.root`).

**Quién la usa:** se levanta con `npm run app:dev` (desde la raíz) o `npm run dev` (desde `apps/nexus-bi-app/`).

**Advertencias:** la app abre `data/warehouse/eyg_nexus.duckdb` en modo `READ_ONLY` únicamente - nunca lo crea ni lo escribe (`lib/duckdb.ts`). Si otra herramienta (DBeaver) tiene el archivo abierto en lectura-escritura, la app falla explícitamente con un mensaje claro, no un 500 genérico.

---

## `data/`

**Propósito:** todos los datos locales, generados o de configuración, del pipeline.

**Fuente/generado:** mixto - ver subcarpetas.

**¿Versionar?** Depende de la subcarpeta - ver abajo. Regla general: `data/raw/` y el binario de DuckDB **no** se versionan (excluidos en `.gitignore`); el resto (`processed/marts/gold/reports/config/curation`) **sí**, porque son CSV/JSON legibles y auditables sin secretos.

### `data/raw/`
**Inmutable.** JSON crudo tal como lo devuelve cada API. **No versionar** (en `.gitignore`). Nunca se edita a mano. Excluido del escaneo profundo de esta auditoría por instrucción explícita.

### `data/processed/`
**Regenerable** desde `data/raw/` corriendo el normalizador correspondiente. CSV, una tabla por entidad, por plataforma (`dolibarr/`, `fieldbeat/`, `zendesk/`). Sí se versiona. No editar a mano - cualquier edición manual se pierde en el próximo `normalize:*`.

### `data/marts/`
**Regenerable** desde `data/processed/` (+ config) corriendo el mart builder correspondiente. Sí se versiona. No editar a mano.

### `data/gold/`
**Regenerable** desde `data/marts/` corriendo el gold builder correspondiente. Sí se versiona. No editar a mano.

### `data/warehouse/`
El archivo `.duckdb` (y su `.wal` si existe) - **no versionar** (en `.gitignore`), 100% reconstruible con `npm run db:build` a partir de `processed/marts/gold`. Excluido del escaneo profundo de esta auditoría.

### `data/config/`
Configuración de entrada **hecha a mano** (no generada por el pipeline): `part_identity_aliases.example.csv` (alias de repuestos, plantilla), `business-hours.json` (horario hábil, real - se commitea directo), `holidays.example.json` (feriados fijos, plantilla incompleta a propósito). Sí se versiona (sin secretos). Editar acá es el mecanismo correcto para ajustar política del negocio.

### `data/curation/`
Modelo de corrección manual - 6 archivos, **todos `.example.csv`** (ningún archivo real todavía, porque el Centro de Correcciones que los escribiría no está implementado). Sí se versiona. Ver duplicado conceptual con `data/config/part_identity_aliases.example.csv` en [PROJECT_CLEANUP_CANDIDATES.md](PROJECT_CLEANUP_CANDIDATES.md) - son plantillas de dos schemas distintos, no el mismo archivo repetido.

### `data/reports/`
Reportes de auditoría/validación/resumen de build - JSON (resúmenes) y algunos CSV (colas de detalle, ej. repuestos sin match). Todos **generados** por scripts de `src/qa/`, `src/marts/`, `src/gold/`, `src/db/`. Sí se versiona (son pequeños, legibles, sin secretos, y documentan el estado del último build). No editar a mano.

---

## `docs/`

**Propósito:** documentación técnica y de producto - arquitectura, diccionario de datos, especificación de UI, modelo de curación, límites de alcance, y material histórico/de referencia de proyectos anteriores (Proyecto 4/5/6/7).

**Fuente/generado:** documentación hecha a mano (DOC), más varios artefactos legacy (PDF/HTML/XLSX/CSV/JSON de "levantamiento" y proyectos previos) que son material de referencia, no generados por este pipeline.

**¿Versionar?** Sí, todo - son referencia, no secretos.

**Advertencias:**
- Varios docs son snapshots de un punto en el tiempo (`PHASE_1_CLOSEOUT.md`, `SCOPE_AND_LIMITATIONS.md`, `KNOWN_LIMITATIONS_PHASE_1.md`, `PHASE_2_BACKLOG.md`, `PHASE_2_HANDOFF.md`) - los números que citan están "congelados a la fecha", no se actualizan solos.
- `BI_READINESS.md` afirma que "no se construyó ningún dashboard todavía", lo cual ya no es cierto (existe `/dashboard/operacional` y varias vistas más) - desactualizado, ver [PROJECT_CLEANUP_CANDIDATES.md](PROJECT_CLEANUP_CANDIDATES.md).
- El material de "Proyecto 4/5/6/7" (HTML, PDF, XLSX, CSV, el JSON con nombre URL-encoded) es referencia histórica de un sistema predecesor (Google Apps Script), no algo que este pipeline lea ni escriba - ver detalle en [PROJECT_CLEANUP_CANDIDATES.md](PROJECT_CLEANUP_CANDIDATES.md).

---

## `sql/`

**Propósito:** paquete de queries SQL reutilizables sobre `data/warehouse/eyg_nexus.duckdb` (copiar/pegar en DuckDB CLI, DBeaver, etc.) - no forman parte del pipeline de build, ningún script de Node las ejecuta.

**Fuente/generado:** fuente (SQL escrito a mano).

**¿Versionar?** Sí.

**Quién la usa:** cualquiera con acceso a DuckDB CLI/DBeaver/extensión SQL, siguiendo `sql/README.md`.

---

## Carpetas que NO deberían versionarse (ya cubiertas en `.gitignore`)

```
node_modules/
.next/
data/raw/
data/warehouse/          (incluye *.duckdb y *.wal)
.env
```

`apps/nexus-bi-app/node_modules/` y `apps/nexus-bi-app/.next/` quedan cubiertos por los mismos patrones sin slash inicial (`node_modules/`, `.next/`), que en `.gitignore` matchean a cualquier profundidad - confirmado, no aparecen en `git status`.
