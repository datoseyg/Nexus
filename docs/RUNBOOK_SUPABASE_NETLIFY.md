# Runbook de liberación — Supabase + Netlify

Estado de este documento: rebaselinado contra el repositorio el 2026-07-20. Esta etapa es exclusivamente local y documental. No autoriza desplegar, crear usuarios productivos, ejecutar DDL, migrar, validar contra Supabase ni modificar datos remotos.

> **Nexus V3 (2026-07-31).** Este runbook describe el proyecto Supabase auditado (Nexus V2). NEXUS V3 introduce un mecanismo de actualización manual de datos (`pipeline.refresh_runs`, `scripts/pipeline/run-data-refresh.mjs`) pensado para un proyecto Supabase **separado y todavía no creado** - nunca escribe ni migra sobre este proyecto V2 (guard `src/lib/db-safety.js::assertKnownSupabaseProject`, exige que `SUPABASE_PROJECT_REF_V3` coincida con el destino real antes de cualquier escritura). Ver [data-refresh-runbook.md](data-refresh-runbook.md) y [adr/0002-nexus-v2-v3-project-separation.md](adr/0002-nexus-v2-v3-project-separation.md).

Baseline de liberación:

- `Frontend-Rev`: previews de Netlify.
- `main`: producción, después de promoción revisada desde `Frontend-Rev`.
- La antigua rama `supabase-migration` no es baseline vigente.
- La auditoría se realizó en `Control-Acceso`, commit `6a699960ed038ae395c73057f98b515c5a667321`, que coincide con `Frontend-Rev`, más el working tree de AUTH-P0 aún no consolidado.

Documentos operativos vinculados:

- [Delta de despliegue](DEPLOYMENT_DELTA_REPORT.md)
- [Matriz de variables](DEPLOYMENT_VARIABLE_MATRIX.md)
- [Inventario y orden SQL](DEPLOYMENT_SQL_INVENTORY.md)
- [Checklist y gates](DEPLOYMENT_RELEASE_CHECKLIST.md)
- [Catálogo de comandos y operaciones autorizables](DEPLOYMENT_COMMAND_CATALOG.md)
- [Contraste con fuentes oficiales](research/2026-07-20-deploy-rebaseline-official-sources.md)

## 1. Reglas inviolables

1. Nunca ejecutar DDL, migraciones, `TRUNCATE`, importaciones o validadores que escriben sobre un proyecto remoto sin autorización explícita para el destino exacto.
2. Nunca almacenar `service_role`, una secret key de Supabase ni credenciales administrativas en Netlify. La aplicación usa la publishable key para Auth y `nexus_app` para PostgreSQL.
3. No exponer `raw`, `processed`, `marts`, `gold`, `audit`, `manual_review`, `stock` ni `config` mediante PostgREST. La aplicación accede a ellos solamente desde Route Handlers server-side.
4. Mantener `NEXUS_SHOW_AUDIT=false` y `NEXUS_SHOW_EXPLORER=false` durante la primera liberación.
5. Ningún smoke de preview o producción puede escribir. Los POST/PUT/PATCH/DELETE se validan con tests locales contra destinos desechables, no con datos remotos.
6. Un rollback de Netlify revierte el frontend, no el estado de PostgreSQL. Toda mutación de base exige backup, verificación previa y rollback propio.

## 2. Secuencia de liberación

La secuencia obligatoria es:

```text
local → Supabase → Auth → preview (Frontend-Rev) → producción (main)
```

Cada flecha es un gate. Si un gate falla, detenerse; no avanzar para “probar si el siguiente paso funciona”. El checklist contiene evidencia y rollback requeridos.

### Gate 0 — Baseline y working tree

- Confirmar que la rama candidata es `Frontend-Rev` y registrar el SHA.
- Confirmar que el diff solo contiene cambios aprobados, que no hay secretos y que AUTH-P0 está consolidado.
- Confirmar que `main` no contiene commits divergentes no incorporados.
- Ejecutar las pruebas locales del catálogo. No usar credenciales remotas.

Salida esperada: typecheck, tests, integración desechable, build, smoke anónimo y diff check verdes.

### Gate 1 — Local y PostgreSQL desechable

1. Construir el warehouse local con los comandos vigentes del repositorio.
2. Regenerar `sql/010_processed.sql`, `020_marts.sql` y `030_gold.sql` únicamente si el warehouse candidato es definitivo; revisar su diff.
3. Aplicar los 15 archivos del inventario, en orden, a PostgreSQL 16 desechable.
4. Probar importadores y rutas de escritura solo contra una base marcada `DISPOSABLE_TEST`.
5. Verificar la certificación local de Gate 1B antes de solicitar autorización para apuntar a Supabase.

Gate 1B cerrado localmente: migrador y validador consumen el mismo ownership manifest; el validador es read-only y el registro de auditoría vive en `db:pg:record-validation`, separado y sujeto a guard. `db:pg:build` pasó dos veces en PostgreSQL 16 desechable con `LOAD_RAW=false`. Esto elimina el blocker técnico local, pero no autoriza conexión, DDL, migración, validación ni recorder contra Supabase.

### Gate 2 — Supabase: proyecto y DDL

Requiere autorización remota separada.

1. Crear o seleccionar el proyecto de destino y registrar project ref, región y propósito.
2. Obtener un backup o snapshot verificable del proyecto si no es nuevo.
3. Inspeccionar el schema real y comparar cada objeto con el inventario; no asumir que el proyecto “versión 1” está vacío ni compatible.
4. Resolver primero las precondiciones de `sql/085_contract_version_revision_uniqueness.sql`, especialmente filas históricas `is_current=false` sin `superseded_at`.
5. Ejecutar los 15 SQL en orden con rol administrativo, deteniéndose ante el primer error.
6. Cambiar la contraseña placeholder de `nexus_app` mediante un secreto generado y guardado fuera del repositorio.
7. Verificar grants, schemas no expuestos y objetos creados antes de cargar datos.

Conectividad administrativa:

- Preferida: conexión directa `db.<project-ref>.supabase.co:5432`; requiere conectividad IPv6.
- Fallback IPv4: session pooler compartido `aws-*.pooler.supabase.com:5432`, con el usuario exacto mostrado por Supabase. Conserva semántica de sesión y sirve para DDL/migración desde una estación administrativa.
- No usar transaction pooler `:6543` para DDL o migraciones administrativas.

Rollback: un proyecto nuevo se descarta solo con autorización. En un proyecto existente, no hay rollback genérico seguro: restaurar snapshot o ejecutar un plan SQL revisado objeto por objeto. Nunca compensar un fallo con un `TRUNCATE` improvisado.

### Gate 3 — Sincronización y validación de Supabase

Requiere autorización remota específica. El blocker local de Gate 1B está resuelto; la compatibilidad del proyecto remoto sigue sin comprobarse.

- `src/db/migrate-to-supabase.js` carga cada objeto `DUCKDB_SYNC` en staging y ejecuta el reemplazo publicado (`TRUNCATE ... RESTART IDENTITY` + `INSERT`) dentro de una única transacción, sin `CASCADE`; `LOAD_RAW` permanece `false` salvo autorización explícita adicional.
- Las tablas `EXTERNAL`, `POSTGRES_BUILDER` y `POSTGRES_TRANSACTIONAL`, y las vistas Postgres-native no aplicables, no se reemplazan desde DuckDB.
- La migración exige `SUPABASE_DB_URL_DIRECT` y dos tokens exactos: `CONFIRM_WRITE_TARGET` y `CONFIRM_PROTECTED_WRITE_TARGET`, ambos `host:port/database` del destino.
- Antes de migrar, capturar conteos, constraints y backup. Después, ejecutar un validador ya corregido y consultas read-only de reconciliación.
- No automatizar este paso en Netlify.

Rollback: ante un fallo de carga staging o del swap transaccional, la tabla publicada conserva su estado anterior. Para fallos de DDL, corrupción lógica o una cadena ya confirmada, restaurar el snapshot previo; la atomicidad por tabla no reemplaza backup/restore.

### Gate 4 — Supabase Auth

Requiere autorización separada para crear las dos cuentas.

1. Crear las identidades técnicas cuyos emails correspondan a `NEXUS_AUTH_GERENCIA_EMAIL` y `NEXUS_AUTH_ADMINISTRACION_EMAIL`.
2. Configurar `app_metadata.nexus_role` server-controlled como `gerencia` o `administracion`.
3. Deshabilitar registro público y verificar URLs de redirección permitidas para preview y producción.
4. Entregar contraseñas por canal seguro; nunca registrarlas en archivos ni logs.
5. Probar login, renovación, expiración, rol inválido, open redirect y logout antes de producción.

Rollback: bloquear o eliminar las cuentas creadas, rotar credenciales y retirar las URLs de preview autorizadas. No modificar usuarios productivos sin autorización específica.

## 3. Netlify y OpenNext

`netlify.toml` en la raíz es la única configuración versionada; `apps/nexus-bi-app/netlify.toml` no existe y no debe duplicarse. La configuración coherente del monorepo es:

| Campo Netlify | Valor | Semántica |
|---|---|---|
| Base directory | `apps/nexus-bi-app` | Directorio desde el que se instalan dependencias y se ejecuta build |
| Package directory | vacío/no configurado | No es un npm workspace; no duplicar `base` |
| Build command | `npm run build` | Resuelve al script `next build` del package de la app |
| Publish directory | `.next` | Relativo a `base`; no usar `apps/nexus-bi-app/.next` |

La integración Next.js vigente de Netlify usa OpenNext automáticamente. La referencia explícita `@netlify/plugin-nextjs` era legacy y fue retirada. No instalar ni declarar ese plugin salvo una incompatibilidad futura demostrada por documentación y logs actuales.

Configuración de ramas:

- Preview: `Frontend-Rev` y deploy previews de cambios revisados.
- Producción: `main` únicamente.
- Desactivar auto-publicación de ramas distintas de `main`; usar contexto branch/deploy-preview para valores no productivos.

## 4. Variables por superficie

La matriz exacta está en `DEPLOYMENT_VARIABLE_MATRIX.md`. Resumen:

- Build + Functions: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Functions solamente: `SUPABASE_DB_URL`, `DATABASE_SSL_MODE`, `DATABASE_SSL_CA_B64`, emails de roles, `NEXUS_ADMIN_TOKEN` y flags.
- Administración local solamente: `SUPABASE_DB_URL_DIRECT`, confirmaciones de escritura e importadores.
- Smoke local/CI: `BASE_URL`, `PORT`, `SMOKE_TIMEOUT_MS`.

Las variables de runtime de Functions deben configurarse en Netlify UI/CLI/API con el scope correcto; no se guardan secretos en `netlify.toml`.

Runtime PostgreSQL serverless:

- `SUPABASE_DB_URL` usa transaction pooler `aws-*.pooler.supabase.com:6543`, rol mínimo `nexus_app`.
- El código usa consultas sin nombre y un pool pequeño, compatible con transaction mode.
- `DATABASE_SSL_MODE=verify-full` (verificación estricta de certificado + hostname, nunca solo cifrado) es el modo Cloud - también el default si se omite. Exige `DATABASE_SSL_CA_B64` (PEM de la CA raíz de Supabase, en base64, server-only - nunca una ruta de archivo). `DATABASE_SSL_MODE=require` ya no es un valor válido.
- No usar la conexión directa ni el session pooler como runtime serverless.
- `SUPABASE_DB_URL`/`GOVERNANCE_*_DB_URL` nunca deben incluir `sslmode`/`sslrootcert`/`sslcert`/`sslkey` en la connection string - el runtime rechaza el arranque si los detecta (el TLS se controla exclusivamente desde `DATABASE_SSL_MODE`/`DATABASE_SSL_CA_B64`, ver `lib/db.ts`).

## 5. Protección esperada

- Las páginas privadas se validan en servidor mediante `requireAuthenticatedUser`/`requireRole`; `proxy.ts` renueva sesiones y redirige páginas, pero no reemplaza la autorización de cada recurso.
- Las APIs de lectura usan `requireReadApiAccess`: sin sesión devuelven JSON `401`; rol inválido devuelve `403`.
- Las APIs administrativas conservan `requireAdminToken` y no pasan por el proxy de sesión.
- El explorador limita schemas a `processed`, `marts` y `gold`.
- Auditoría y Explorador permanecen ocultos con ambos flags en `false`; ocultar navegación no sustituye la autorización.

Mapa de páginas:

- pública: `/login`;
- privadas: `/`, `/dashboard/**`, `/audit/**`, `/explorer/**` y `/search/**`;
- recursos estáticos de Next quedan fuera del control de sesión;
- usuario ya autenticado que visita `/login` vuelve a `/`.

Mapa de APIs:

- lectura autenticada: `/api/dashboard/**`, `/api/audit/**`, `/api/search/**` y `/api/tables/**`;
- administración por secreto técnico: `/api/admin/**`, omitida deliberadamente por `proxy.ts` y protegida dentro de cada handler con `requireAdminToken`;
- `proxy.ts` no autoriza APIs: cada handler debe aplicar su guard y emitir JSON, nunca redirects HTML.

Inventario observado: 39 Route Handlers, de los cuales 29 usan la capa de lectura autenticada y 10 el token administrativo. Cualquier Route Handler nuevo debe incorporarse explícitamente a una de esas dos políticas.

## 6. Smoke de preview y producción

### No autenticado, automatizable y read-only

Desde `apps/nexus-bi-app`:

```powershell
$env:BASE_URL='https://<deploy-preview>'; npm run smoke
```

El script actual comprueba `/login` con `200`, redirecciones `307` de páginas privadas y `401` JSON de APIs sin sesión. No escribe.

### Autenticado, read-only

El repositorio todavía no contiene un smoke autenticado automatizado. Hasta que exista un harness seguro, realizar en preview una verificación manual con cada identidad autorizada:

1. Login correcto y retorno solo a una ruta interna.
2. Shell muestra la identidad esperada.
3. `/`, dashboards y una API GET autorizada responden correctamente.
4. Rol ausente/inválido obtiene `403` en API.
5. `?next=https://example.com` no abandona el origen.
6. Tras logout, página privada redirige y API GET devuelve `401`.
7. Esperar o simular expiración en el entorno de prueba y confirmar renovación o retorno seguro a login.

No usar ninguna mutación administrativa como smoke. En producción, repetir solamente lecturas y logout; no crear filas de prueba.

## 7. Promoción y rollback

### Gate 5 — Code review

- Ejecutar en paralelo los ejes Standards y Spec contra el SHA candidato y el alcance de release.
- Exigir `BLOCKERS=0` y `HIGH=0`; resolver o aceptar explícitamente findings menores.
- Si cambia código/config/documentación material después del review, repetir el eje afectado.

Rollback: no crear ni promover preview.

### Gate 6 — Preview (`Frontend-Rev`)

- Build OpenNext verde.
- Variables de preview apuntan exclusivamente a recursos no productivos aprobados.
- Smokes anónimo y autenticado read-only verdes.
- Logs sin secretos, errores de runtime o conexiones directas.

Rollback: cancelar promoción, bloquear el deploy de preview y rotar cualquier secreto de preview expuesto. No tocar producción.

### Gate 7 — Producción (`main`)

1. Merge revisado de `Frontend-Rev` a `main` con SHA registrado.
2. Ventana y responsables aprobados; backups y rollback disponibles.
3. Variables productivas verificadas por nombre/scope sin mostrar sus valores.
4. Deploy de `main`; no ejecutar migración como parte del build.
5. Smoke productivo estrictamente read-only.

Rollback de aplicación: publicar el deploy anterior de Netlify y confirmar sus variables. Si hubo una operación de base autorizada, seguir su plan de restauración por separado; revertir el frontend no revierte DDL ni datos.

## 8. Estado al cierre de esta etapa

El runbook queda utilizable como baseline documental y la cadena quedó certificada únicamente en PostgreSQL 16 local desechable. La ejecución remota permanece detenida por autorización; este estado no certifica que el proyecto Supabase antiguo sea compatible ni que `db:pg:build` esté autorizado para producción.

```text
DEPLOYMENT_RUNBOOK_REBASELINED
REMOTE_EXECUTION_PENDING_AUTHORIZATION
```
