# ADR 0002 — Separación estricta entre proyectos Supabase Nexus V2 y V3

Fecha: 2026-07-31
Estado: Aceptada

## Contexto

Nexus V3 (este trabajo) nunca debe sobrescribir ni alterar automáticamente Nexus V2 (producción actual). El mecanismo de actualización de datos escribe hacia un destino Postgres configurado por variable de entorno (`SUPABASE_DB_URL_DIRECT`) — el riesgo real es que, por un error de configuración (variable de entorno mal apuntada, `.env` equivocado, secreto de GitHub Environment mal cargado), una corrida de refresh V3 termine sincronizando datos contra el proyecto Supabase de V2.

El guard existente antes de esta tarea (`assertWriteConfirmed`) solo distingue "¿es un host/nombre de base protegido?" y exige un token `host:puerto/base` — insuficiente para distinguir **dos proyectos Supabase cloud distintos** que podrían, en teoría, compartir un patrón de host similar o cuyo token de confirmación alguien copie-pegue por error desde el destino equivocado.

## Decisión

Se agregó una capa de guard adicional, específica para este riesgo, en `src/lib/db-safety.js`:

- `parseSupabaseProjectRef(target)` extrae el project ref real de una connection string Supabase (del host directo `db.<ref>.supabase.co`, o del usuario del pooler `<user>.<ref>`).
- `assertKnownSupabaseProject(connectionString, { expectedProjectRefEnvVar })` compara ese ref contra una variable de entorno esperada (`SUPABASE_PROJECT_REF_V3` por defecto) y **aborta antes de cualquier escritura** si no coinciden, si no se puede extraer el ref, o si la variable esperada ni siquiera está definida.
- El orquestador (`scripts/pipeline/run-data-refresh.mjs`) llama esta función **antes** de tocar `migrateToSupabase()`, en la etapa `SYNC_POSTGRES` — es la primera verificación de esa etapa, antes de fijar los tokens de `assertWriteConfirmed`.

Esto es una capa **adicional** sobre `assertWriteConfirmed`, no un reemplazo: un token `CONFIRM_WRITE_TARGET`/`CONFIRM_PROTECTED_WRITE_TARGET` correcto pero apuntado al proyecto V2 sigue siendo rechazado, porque el project ref no coincide con `SUPABASE_PROJECT_REF_V3` (verificado explícitamente con un test dedicado, `test/lib/db-safety.test.js`).

## Alternativas consideradas

- **Confiar solo en que el operador configure bien las variables de entorno.** Rechazada: es exactamente el tipo de error humano silencioso que este guard existe para atrapar — un solo secreto mal cargado en GitHub Actions no debe poder alcanzar V2.
- **Hardcodear el project ref de V3 en el código.** Rechazada: V3 todavía no existe como proyecto real (ver informe de cierre); hardcodear un valor inventado sería peor que exigir la variable y fallar ruidosamente si falta.
- **Confiar en el nombre de la base de datos en vez del project ref.** Rechazada: dos proyectos Supabase distintos pueden perfectamente compartir el mismo nombre de base (`postgres`, por convención de Supabase) — el project ref (parte del hostname/usuario del pooler) es el único identificador que realmente distingue un proyecto de otro a nivel de connection string.

## Consecuencias

- Antes de la primera corrida real contra Supabase V3, hace falta crear ese proyecto y fijar `SUPABASE_PROJECT_REF_V3` (por entorno, vía GitHub Environments para STAGING/PRODUCTION) — documentado en [../data-refresh-runbook.md](../data-refresh-runbook.md).
- Cualquier futuro script que escriba hacia Supabase puede reutilizar `assertKnownSupabaseProject` con el mismo patrón, sin duplicar esta lógica de extracción/comparación de project ref.
