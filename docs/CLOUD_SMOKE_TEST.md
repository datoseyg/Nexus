# Cloud Smoke Test - Demo estática en Cloudflare Pages

## Qué es esta demo

Un primer despliegue **read-only** de Nexus BI a Cloudflare Pages, para mostrar la UI sin exponer el warehouse DuckDB local ni depender de un servidor Node.

Funciona con un tercer modo de datos, controlado por `NEXT_PUBLIC_DATA_MODE`:

| Valor | Fuente de datos | Dónde corre |
|---|---|---|
| `local-duckdb` (default) | `data/warehouse/eyg_nexus.duckdb` vía Route Handlers | `npm run app:dev` / `npm run app:build` local |
| `static` | JSON pre-generado en `apps/nexus-bi-app/public/data/cloud/` | Cloudflare Pages (este documento) |
| `d1` | (no implementado todavía) | Fase futura |

El helper `apps/nexus-bi-app/lib/data-mode.ts` (`getDataMode()`, `isStaticMode()`, `isLocalDuckDbMode()`) es la única fuente de verdad sobre en qué modo está corriendo la app.

## Qué NO incluye este corte

- **No** migra ninguna pantalla para consumir el snapshot estático todavía - `apps/nexus-bi-app/lib/static-data-client.ts` expone los getters (`getOperationalSummary()`, `getAuditSummary()`, etc.) listos para usarse, pero los componentes existentes (`OperationalDashboardTab`, `AuditManualReviewShell`, etc.) siguen llamando a `/api/*`. En el build estático esas llamadas van a fallar en el navegador (no hay servidor Node en Cloudflare Pages) - es un límite conocido de este corte, no un bug. Cablear cada pantalla al cliente estático queda para un paso siguiente.
- **No** implementa D1 ni ninguna base de datos en la nube.
- **No** expone filtros interactivos en el snapshot estático (es un resumen fijo, sin cross-filter).
- **No** hace deploy automático - subir a Cloudflare Pages sigue siendo un paso manual.
- **No** toca `.env`, `data/raw/`, ni `data/warehouse/eyg_nexus.duckdb` - siguen fuera de `public/` y fuera de git (ver `.gitignore`).

## Qué SÍ muestra

Un banner "Modo demo cloud read-only · Snapshot estático" (siempre visible cuando `NEXT_PUBLIC_DATA_MODE=static`, montado en `AppShell`) y los archivos JSON del snapshot son navegables directamente (`/data/cloud/metadata.json`, etc.) para verificar que el pipeline de exportación produce datos sanitizados y razonables.

## Paso a paso

### 1. Construir el warehouse local (si no existe o está desactualizado)

```bash
npm run db:build
```

Corre `db:init` + `db:load` + `db:validate` contra los CSV de `data/gold`, `data/marts`, etc. Requiere que `data/warehouse/` exista (se crea sola) - nunca commitea el `.duckdb`.

### 2. Exportar el snapshot cloud (sanitizado)

```bash
npm run cloud:export-snapshot
```

Corre `src/cloud/export-cloud-snapshot.js`: abre `data/warehouse/eyg_nexus.duckdb` en `READ_ONLY`, arma resúmenes agregados (nunca filas crudas con descripciones de ticket o RUT de cliente) y los pasa por `src/cloud/sanitize-cloud-export.js` (redacción de emails/teléfonos/tokens + truncado de texto largo) antes de escribir en `apps/nexus-bi-app/public/data/cloud/`:

- `metadata.json`
- `dashboard-operacional-summary.json`
- `dashboard-operacional-parts.json`
- `audit-summary.json`
- `audit-manual-review.sample.json` (muestra acotada a 20 filas, solo columnas sin PII)
- `after-hours-summary.json`
- `equipment-lifecycle-summary.json` (solo si `gold.equipment_part_lifecycle_summary` existe)
- `scope-warnings.json`

### 3. Preflight de seguridad

```bash
npm run cloud:preflight
```

Corre `src/cloud/preflight-cloud-demo.js`, que valida (sin modificar nada):

- que no haya `.env`, `data/raw/` ni `*.duckdb` dentro de `apps/nexus-bi-app/public/`
- que existan todos los JSON esperados y que `metadata.json` sea válido
- que ningún JSON tenga patrones evidentes de email/teléfono/token sin redactar
- que ningún archivo sea excesivamente grande

Escribe `data/reports/cloud_preflight_summary.json` con estado `READY`, `READY_WITH_WARNINGS` o `NOT_READY`. **No subas a Cloudflare si el estado es `NOT_READY`.**

### 4. Build estático de Next.js

```bash
npm run app:build:static
```

Equivale a `cd apps/nexus-bi-app && npm run build:static`, que corre `cross-env NEXT_PUBLIC_DATA_MODE=static node scripts/build-static.mjs`.

**Por qué un script wrapper y no `next build` directo:** `output: "export"` (que `next.config.ts` activa solo cuando `NEXT_PUBLIC_DATA_MODE=static`) no es compatible con los ~30 Route Handlers dinámicos de `app/api/**` (leen `request.nextUrl.searchParams` para filtrar contra DuckDB) - Next.js aborta el build entero si los detecta. `scripts/build-static.mjs` mueve `app/api/` a una carpeta temporal *antes* de invocar `next build` y la restaura *después*, pase lo que pase (incluso si el build falla). El modo `local-duckdb` (`npm run app:dev` / `npm run app:build` normales) nunca pasa por este script.

El resultado queda en `apps/nexus-bi-app/out/` - contenido 100% estático, listo para subir.

### 5. Subir a Cloudflare Pages (manual)

1. En el dashboard de Cloudflare Pages, crear un proyecto nuevo (o usar uno existente) apuntando a este repo.
2. Build command: `npm run app:build:static` (corrido desde la raíz `eyg-nexus-local/`).
3. Build output directory: `apps/nexus-bi-app/out`.
4. Variables de entorno del build: `NEXT_PUBLIC_DATA_MODE=static` (ya la fija el script, pero conviene declararla también en el panel de Cloudflare por si se dispara un build sin pasar por `npm run app:build:static`).
5. **No** configurar ninguna variable de `.env` (Zendesk/FieldBeat/Dolibarr) en Cloudflare - esta demo no llama APIs externas.

Este paso queda manual a propósito (ver restricciones de la tarea) - no hay CI/CD conectado todavía.

### 6. Volver al modo local

No hace falta ningún revert: `npm run app:dev` y `npm run app:build` (sin `:static`) nunca setean `NEXT_PUBLIC_DATA_MODE`, así que `getDataMode()` cae al default `local-duckdb` y la app vuelve a pegarle a DuckDB local como siempre. `scripts/build-static.mjs` restaura `app/api/` automáticamente al terminar (incluso si falló a mitad de camino), así que no queda ningún directorio movido de una corrida anterior.

## Troubleshooting

- **`cloud:preflight` da `NOT_READY` por PII**: revisar qué archivo marcó `pii_scan_hits` en `data/reports/cloud_preflight_summary.json`, y si es necesario ajustar qué columnas selecciona `export-cloud-snapshot.js` (preferir excluir la columna en el `SELECT` antes que confiar solo en la redacción por regex).
- **`build-static.mjs` dice que ya existe `.cloud-static-build-tmp/api`**: quiere decir que una corrida anterior se interrumpió a la mitad. Revisar manualmente si `apps/nexus-bi-app/app/api/` falta y restaurarlo desde `apps/nexus-bi-app/.cloud-static-build-tmp/api/` antes de reintentar.
- **Faltan JSON en el snapshot**: correr `npm run cloud:export-snapshot` de nuevo después de `npm run db:build` - si sigue faltando alguno no-opcional, revisar la consola del script (imprime cada archivo que escribe).
