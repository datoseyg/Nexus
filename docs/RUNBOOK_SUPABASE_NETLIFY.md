# Runbook — despliegue cardless (Supabase + Netlify, con Plan B Vercel)

Guía paso a paso para levantar `apps/nexus-bi-app` contra Supabase Postgres en vez de DuckDB local, sin usar ningún servicio que exija tarjeta. Ver [ARCHITECTURE.md § Legacy: Cloudflare](ARCHITECTURE.md#legacy-cloudflare) para contexto de por qué esta es la segunda ruta cardless del proyecto (la primera, Cloudflare R2, quedó congelada por eso mismo).

## 0. Antes de empezar

- Repo en la rama `supabase-migration`, con las Fases -1 a 5 ya commiteadas (schemas SQL, scripts de migración, `lib/db.ts`, rutas migradas, CRUD admin).
- `npm install` corrido tanto en la raíz como en `apps/nexus-bi-app/`.
- El pipeline CSV/DuckDB local ya corrido al menos una vez (`npm run db:build` desde la raíz) — la migración parte de un `data/warehouse/eyg_nexus.duckdb` real.

## 1. Crear el proyecto Supabase (gratis, sin tarjeta)

1. [supabase.com](https://supabase.com) → crear cuenta → "New project".
2. Elegir organización, nombre del proyecto, región (la más cercana), y una contraseña para el rol `postgres` (guardarla — es la que se usa para correr el DDL, no la de `nexus_app`).
3. El plan Free de Supabase no pide tarjeta para este tamaño de proyecto (base de datos hasta 500MB, ver riesgo de presupuesto de espacio en el plan de migración). Si en algún momento el flujo de creación pide un método de pago, **no completar el paso** — es señal de que las condiciones cambiaron desde que se escribió este runbook; documentarlo y avisar antes de seguir.
4. Esperar a que el proyecto termine de aprovisionar (unos minutos).

## 2. Correr el DDL (`sql/*.sql`)

En el dashboard de Supabase → **SQL Editor** → "New query". Correr, **en este orden exacto**, pegando el contenido completo de cada archivo:

```
sql/000_roles_and_schemas.sql
sql/005_raw.sql
sql/010_processed.sql
sql/020_marts.sql
sql/030_gold.sql
sql/040_audit.sql
sql/050_manual_review.sql
sql/060_stock.sql
```

Todos son idempotentes (`IF NOT EXISTS`) — si algo falla a mitad de camino, corregir y re-correr desde ese archivo, no hace falta empezar de cero.

**Antes de seguir, reemplazar la contraseña placeholder del rol `nexus_app`:** `sql/000_roles_and_schemas.sql` crea el rol con `'__SET_IN_SUPABASE_DASHBOARD__'` a propósito — esa contraseña placeholder NUNCA debe usarse en producción. Correr en el SQL Editor:

```sql
ALTER ROLE nexus_app WITH PASSWORD '<contraseña real generada acá, no en un archivo versionado>';
```

Generar la contraseña con un gestor de contraseñas o `openssl rand -base64 24` — guardarla junto a las otras credenciales del proyecto (gestor de secretos del equipo), nunca en un commit.

## 3. Confirmar que los schemas NO están expuestos por PostgREST

Dashboard → **Project Settings → API → Exposed schemas**. Confirmar que la lista sea únicamente `public` (o lo que ya estuviera antes) — **no agregar** `raw`, `processed`, `marts`, `gold`, `audit`, `manual_review`, ni `stock`. Esta es la barrera de seguridad principal (ver plan de migración § Decisiones de arquitectura): mientras estos 7 schemas no estén en esa lista, la API REST pública de Supabase (anon key) nunca puede leerlos ni escribirlos — el único camino de acceso es la conexión `pg` server-side de Next.js.

## 4. Obtener las connection strings

Dashboard → **Project Settings → Database → Connection string**:

- **Direct connection** (puerto 5432, `db.<project-ref>.supabase.co`): solo para los scripts de migración/DDL que corren una vez desde tu máquina local. Nunca se usa desde la app desplegada.
- **Connection pooler** (Supavisor, puerto 6543, modo *Transaction*, host `aws-*.pooler.supabase.com` o similar): la que usa `apps/nexus-bi-app/lib/db.ts` en runtime. Netlify/Vercel son serverless — conexiones directas agotarían el límite de conexiones de Supabase rápido bajo carga concurrente (ver riesgo 2 del plan de migración).

Para ambas, reemplazar el usuario/password por el rol `nexus_app` (no `postgres`) y la contraseña real que generaste en el paso 2:

```
# Directa (para migración local, .env de la raíz)
SUPABASE_DB_URL_DIRECT=postgresql://nexus_app:<password>@db.<project-ref>.supabase.co:5432/postgres

# Pooler (para runtime de la app, .env.local de apps/nexus-bi-app)
SUPABASE_DB_URL=postgresql://nexus_app.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

(El formato exacto de usuario en el pooler — `nexus_app.<project-ref>` — lo confirma el propio dashboard de Supabase al mostrar la connection string del pooler; copiarlo de ahí en vez de adivinarlo.)

## 5. Migrar los datos (una vez, desde tu máquina)

Desde la raíz del repo, con `SUPABASE_DB_URL_DIRECT` ya en `.env`:

```bash
npm run db:pg:build
```

Esto corre `db:pg:ddl` (regenera `sql/010-030` por si el warehouse cambió), `db:pg:migrate` (TRUNCATE+INSERT de las 40 tablas de processed/marts/gold hacia Postgres) y `db:pg:validate` (los 4 chequeos — filas, tablas, columnas, tipos). Si `db:pg:validate` falla, revisar `data/reports/supabase_validation_summary.json` antes de seguir — no continuar al paso 6 con una migración a medias.

Confirmar el resultado directamente en Supabase (SQL Editor):

```sql
SELECT * FROM audit.warehouse_sync_state ORDER BY synced_at DESC LIMIT 1;
```

Debería mostrar `validation_status = 'PASSED'`.

**Cargar `raw` es opcional y queda apagado por default** (106MB de JSON, ver riesgo de presupuesto de espacio) — solo si hace falta: `LOAD_RAW=true npm run db:pg:migrate`.

## 6. Desplegar la app — gate-check de billing antes de elegir host

Netlify y Vercel comparten el mismo backend (Supabase) y el mismo código — el único cambio real es la plataforma de hosting. Las cuentas nuevas de Netlify vienen usando planes basados en créditos desde 2025; no está garantizado que el free tier siga siendo 100% cardless. Por eso:

1. Probar primero el signup de Netlify **sin completar ningún paso de billing**.
2. Si en algún punto pide tarjeta para el uso previsto (1 sitio, tráfico bajo, Next.js App Router) → pasar directo a la sección Vercel de abajo. Ninguna de las dos rutas es "la buena" — la que no pida tarjeta, es esa.

### 6a. Netlify

1. [netlify.com](https://netlify.com) → signup (GitHub recomendado, para conectar el repo directo).
2. "Add new site" → "Import an existing project" → conectar el repo `datoseyg/Nexus` (o el fork que corresponda).
3. Configuración de build:
   - **Base directory:** `apps/nexus-bi-app`
   - **Build command:** `npm run build`
   - **Publish directory:** `apps/nexus-bi-app/.next` (Netlify detecta Next.js automáticamente vía `@netlify/plugin-nextjs` si el repo tiene `netlify.toml` o si Netlify lo autodetecta al ver `next.config.ts`)
4. Site settings → **Environment variables** → agregar:
   - `SUPABASE_DB_URL` (la del pooler, paso 4)
   - `NEXUS_ADMIN_TOKEN` (generado en el paso 7 de este runbook — ver más abajo)
5. Deploy. Netlify corre `apps/nexus-bi-app/app/api/**` como Netlify Functions — confirmar en los logs de build que no hay errores de "Edge Runtime" (si aparecen, revisar que todas las rutas tengan `export const runtime = "nodejs"`, ver Fase 3/4 del plan de migración).
6. Smoke test (ver sección 7 de abajo) contra la URL de deploy preview antes de promover a producción.

### 6b. Vercel (Plan B completo, no alternativa secundaria)

1. [vercel.com](https://vercel.com) → signup con GitHub.
2. "Add New..." → "Project" → importar `datoseyg/Nexus`.
3. Configuración:
   - **Root Directory:** `apps/nexus-bi-app` (Vercel detecta Next.js automáticamente, no hace falta `vercel.json` para un caso estándar de App Router).
   - **Framework Preset:** Next.js (autodetectado).
4. Project Settings → **Environment Variables** → agregar `SUPABASE_DB_URL` y `NEXUS_ADMIN_TOKEN` (mismos valores que en Netlify).
5. Deploy. Vercel también corre los route handlers como funciones Node.js por default salvo que se declare `edge` explícitamente — como todas las rutas tienen `export const runtime = "nodejs"`, quedan corriendo en el runtime correcto sin configuración adicional.
6. Smoke test contra la preview URL antes de promover a producción (alias de dominio).

## 7. Variables de entorno — resumen y generación del token admin

`NEXUS_ADMIN_TOKEN` protege `/api/admin/**` (ver `lib/auth.ts`) — es un secreto compartido para llamadores server-to-server, **nunca se expone al cliente** (prohibido `NEXT_PUBLIC_NEXUS_ADMIN_TOKEN`, ver Fase 3 del plan de migración). Generarlo con:

```bash
openssl rand -hex 32
```

Variables a configurar (`.env.local` en `apps/nexus-bi-app/`, y el mismo par en el host elegido — nunca en un archivo versionado):

| Variable | Dónde se usa | Valor |
|---|---|---|
| `SUPABASE_DB_URL` | `lib/db.ts` (runtime de la app) | Connection string del **pooler**, rol `nexus_app` |
| `NEXUS_ADMIN_TOKEN` | `lib/auth.ts` (rutas `/api/admin/**`) | Token generado con `openssl rand -hex 32` |

Y en `.env` de la raíz del repo (solo para correr los scripts de migración localmente, nunca en el host desplegado):

| Variable | Dónde se usa |
|---|---|
| `SUPABASE_DB_URL_DIRECT` | `src/db/migrate-to-supabase.js`, `src/db/validate-supabase.js` |

## 8. Smoke test post-deploy

Contra la URL desplegada (deploy preview o producción):

1. Abrir `/dashboard/operacional`, `/dashboard/after-hours`, `/dashboard/fieldbeat`, `/dashboard/uptime`, `/audit/manual-review`, `/explorer`, `/search` — confirmar que cargan datos (los mismos que mostraban contra DuckDB local).
2. `curl -X POST https://<tu-deploy>/api/admin/manual-review/part-aliases -H "content-type: application/json" -d '{}'` sin header de token → esperar `401`.
3. Mismo POST con `-H "x-nexus-admin-token: <tu token>"` y un body válido (`alias_value`, `alias_type`, `dolibarr_product_id`) → esperar `201`.
4. Confirmar en Supabase (Table Editor o SQL Editor) que la fila apareció en `manual_review.part_aliases` y que se generó una fila espejo en `audit.data_quality_events`.

Si los 4 pasos pasan, el despliegue está funcionalmente equivalente al local contra DuckDB, más la capa CRUD nueva.
