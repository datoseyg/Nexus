# 00 — Línea base de la auditoría

Este archivo congela el punto de referencia exacto contra el que se citan todas las afirmaciones de `docs/design-context/`. Ninguna afirmación en ningún otro archivo de esta carpeta debe usar "actual" o "en producción" sin remitirse, implícita o explícitamente, a esta línea base.

## Identidad del repositorio auditado

| Campo | Valor | Clase de evidencia |
|---|---|---|
| Remoto | `https://github.com/datoseyg/Nexus.git` | STATIC_CODE (`git remote -v`) |
| Branch auditada | `supabase-migration` | STATIC_CODE (`git branch --show-current`) |
| Commit HEAD | `4a3d05528e8a970b867848acc80f091cdb1c9454` (short: `4a3d055`) | GIT_HISTORY (`git rev-parse HEAD`) |
| Mensaje del commit HEAD | "fix: lib/api-error.ts arrastraba @duckdb/node-api a TODAS las rutas, tumbando Netlify" | GIT_HISTORY (`git log -1`) |
| Fecha del commit HEAD | 2026-07-09 04:16:59 -0400 | GIT_HISTORY |
| Fecha/hora de esta auditoría | 2026-07-11, sesión iniciada ~06:29 UTC | metadata de sesión |
| Estado del working tree | **Sucio**: `M apps/nexus-bi-app/next-env.d.ts` | STATIC_CODE (`git status --short --branch`) — archivo autogenerado por `next dev`/`next build` (declaración de tipos de Next.js), no representa un cambio funcional pendiente, pero se documenta en vez de descartarse silenciosamente |
| Otras branches locales+remotas | `main`, `cloudflare-migration`, `cloud-d1-readonly`, `cloud-smoke-test` (todas también en `origin`) | GIT_HISTORY (`git branch -a`) |

En todo `docs/design-context/`, cuando se cite "HEAD" o "commit auditado" sin más calificación, se refiere a `4a3d055` en `supabase-migration`. Cualquier evidencia recuperada de otra branch (p. ej. `cloud-d1-readonly`, `cloud-smoke-test`) se cita explícitamente con su propio SHA y se etiqueta `LEGACY`, nunca como parte de este baseline.

## Configuración de despliegue

| Campo | Valor | Clase de evidencia |
|---|---|---|
| Plataforma de deployment declarada | Netlify (primaria), Vercel como "Plan B completo, no alternativa secundaria" | STATIC_DOC (`netlify.toml:1-13`; `docs/RUNBOOK_SUPABASE_NETLIFY.md:110`) |
| Configuración de build | `base=apps/nexus-bi-app`, `command=npm run build`, `publish=.next`, plugin `@netlify/plugin-nextjs` | STATIC_CODE (`netlify.toml:6-13`) |
| Branch configurada para deployment | **DESCONOCIDA desde el repo.** No existe `.netlify/state.json` ni ningún archivo con site ID en el árbol (confirmado: `find . -iname "*.netlify*"` sin resultados fuera de `node_modules`). Netlify normalmente despliega la branch que el propio dashboard de Netlify tiene configurada como production branch — ese valor vive solo en la cuenta de Netlify, no en este repositorio | AUSENCIA CONFIRMADA · comando: `find . -maxdepth 2 -iname "*.netlify*" -not -path "*/node_modules/*"` · directorios: raíz y `apps/nexus-bi-app` · commit `4a3d055` |
| URL de producción | **DESCONOCIDA** — no se encontró ninguna URL `*.netlify.app` ni dominio propio referenciado en `netlify.toml`, `.env.example`, ni `docs/RUNBOOK_SUPABASE_NETLIFY.md` | AUSENCIA CONFIRMADA · comando: `grep -n -i "netlify.app\|\.netlify\.com" docs/RUNBOOK_SUPABASE_NETLIFY.md` · commit `4a3d055` |
| `apps/nexus-edge-pipeline` | Rotulado explícitamente "legacy" y "no se toca" por el propio `netlify.toml` | STATIC_CODE (`netlify.toml:3-4`) |

**Implicación:** no es posible, desde este repositorio, distinguir HEAD local de lo efectivamente desplegado en producción. Toda verificación de esta auditoría contra un runtime real se hizo **localmente** (`npm run dev` sobre `apps/nexus-bi-app`, contra la base de datos Supabase real vía `SUPABASE_DB_URL`), nunca contra la URL de Netlify (desconocida). Ver clase de evidencia `LOCAL_RUNTIME` vs `DEPLOYED_RUNTIME` en el resto de los archivos — **ninguna afirmación de esta auditoría usa `DEPLOYED_RUNTIME`**; donde el punto 5 del encargo pedía verificar correspondencia deployment↔branch, la respuesta es `NOT_RUNTIME_VERIFIED` (dato no disponible, no un error de ejecución).

## Entorno de base de datos auditado

| Campo | Valor | Clase de evidencia |
|---|---|---|
| Motor | PostgreSQL gestionado por Supabase (plan gratuito, sin tarjeta) | STATIC_DOC (`docs/RUNBOOK_SUPABASE_NETLIFY.md:11-16`) |
| Conexión usada en esta auditoría | Pooler Supavisor, puerto 6543, modo transacción, rol `nexus_app` (`SUPABASE_DB_URL` en `apps/nexus-bi-app/.env.local`) — la misma que usa la app en runtime | LOCAL_RUNTIME (conexión real establecida y consultada durante esta sesión, ver más abajo) |
| Rol usado | `nexus_app` — `SELECT`-only en `raw/processed/marts/gold`, CRUD completo en `audit/manual_review/stock` | STATIC_CODE (`sql/000_roles_and_schemas.sql:32-54`) |
| Conexión NO usada | `SUPABASE_DB_URL_DIRECT` (rol `postgres`, puerto 5432) — reservada a scripts de migración (`db:pg:*`), esta auditoría no la tocó | STATIC_DOC (`.env.example:29-35`) |
| Instancia de Supabase auditada vs. la que sirve producción real | **DESCONOCIDA si son la misma.** El `.env.local` de `apps/nexus-bi-app` es el mismo archivo que usaría un `npm run build`/deploy local, y no hay evidencia en el repo de una segunda instancia de Supabase para staging — pero como la URL de producción de Netlify es desconocida (ver arriba), no se puede confirmar en runtime que ambas apunten a la misma base | NOT_RUNTIME_VERIFIED |

## Verificación runtime realizada en esta sesión (LOCAL_RUNTIME)

Ejecutada bajo la regla de autorización de solo-lectura (ver `docs/design-context/11-product-decision-register.md` § metodología, y el plan de auditoría). Resumen:

- `npm run dev` levantado en `apps/nexus-bi-app` sobre `http://localhost:3000`, usando las credenciales reales de `.env.local` — arrancó correctamente (Next.js 16.2.10, listo en 5.0s).
- Conexión a Supabase confirmada real y de lectura: `GET /api/tables` devolvió 200 con 40 tablas reales (`processed`=11, `marts`=8, `gold`=21) — coincide exactamente con la cifra de 40 tablas ya documentada estáticamente en `docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md`.
- Se golpearon con `GET` (método de solo lectura) las 7 páginas de producto y ~30 rutas API de lectura, más las 5 rutas `/api/admin/**` (una vez con el header de token real leído desde `.env.local` sin exponer su valor, y una vez sin token para confirmar el gate 401). **Ninguna petición usó `POST`/`PATCH`/`DELETE` con efecto real** — las únicas pruebas contra métodos mutantes fueron sin token (verifican que el gate de autorización también cubre mutaciones, sin llegar a ejecutarlas: devuelven 401 antes de tocar la base).
- Resultados completos, citados por endpoint, en `04-data-and-api-contracts.md` y `06-system-states.md`. Los cuerpos de respuesta capturados se resumieron a status HTTP + claves de primer nivel + conteos de filas; no se persistieron cuerpos completos con datos potencialmente identificables (nombres de clientes/técnicos) en ningún archivo de este directorio, y no se guardó el valor de `NEXUS_ADMIN_TOKEN` ni de `SUPABASE_DB_URL` en ningún artefacto.
- Comandos base usados (reproducibles): `npm run dev` (en `apps/nexus-bi-app`), `curl -s -o <tmp> -w "%{http_code}" <url>` por endpoint, con inspección de claves top-level vía Node.

## Comandos usados para esta línea base (reproducibles)

```
git remote -v
git branch --show-current
git rev-parse HEAD
git status --short --branch
git log -1 --format="%H %ad %s" --date=iso
cat netlify.toml
find . -maxdepth 2 -iname "*.netlify*" -not -path "*/node_modules/*"
grep -n -i "netlify.app|\.netlify\.com|deploy-branch|production branch|url:" docs/RUNBOOK_SUPABASE_NETLIFY.md
```

## Qué queda abierto (cross-ref `11-product-decision-register.md`)

- URL/branch de producción real de Netlify — desconocida desde el repo, requiere que el dueño del producto la aporte o dé acceso al dashboard de Netlify.
- Si la instancia de Supabase local (`.env.local`) es la misma que sirve producción, o si existe una segunda instancia — desconocido.
