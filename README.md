# Nexus

Pipeline de datos operacional (FieldBeat, Zendesk, Dolibarr) + app BI (`apps/nexus-bi-app`, Next.js sobre Supabase/PostgreSQL) para EYG.

## Desarrollo local completo

### Prerrequisitos

- Node.js 22 o superior.
- Docker Desktop iniciado y con su motor Linux disponible.
- Dependencias instaladas en la raíz mediante `npm install`. La CLI Supabase es la versión fijada en este proyecto; el flujo no descarga otra versión.
- `supabase/config.toml` presente. El flujo nunca ejecuta `supabase init`.

Desde Git Bash en Windows:

```bash
cd /a/Documents/EyG/Codigo/eyg-nexus-local
npm run dev:local
```

`dev:local` comprueba Docker y `supabase/config.toml`, reutiliza Supabase cuando el API ya responde, lo inicia una sola vez cuando está detenido, espera su health y después inicia Next.js. Ante un prerrequisito fallido aborta con un diagnóstico; no resetea la base, no elimina volúmenes y no detiene Supabase al cerrar Next.js.

`npm run dev` dentro de `apps/nexus-bi-app` continúa iniciando solamente Next.js, pero su `predev` verifica primero el API local. Para el entorno completo debe preferirse el comando de la raíz.

Puertos definidos en `supabase/config.toml`:

| Servicio | Destino local |
|---|---|
| Shadow DB | `127.0.0.1:13320` |
| API/Auth/REST de Supabase | `http://127.0.0.1:13321` |
| PostgreSQL de Supabase CLI | `127.0.0.1:13322` |
| Supabase Studio | `http://127.0.0.1:13323` |
| Mailpit | `http://127.0.0.1:13324` |
| Analytics | `127.0.0.1:13327` |
| Pooler (deshabilitado) | `127.0.0.1:13329` |

La fuente única de estos valores es `supabase/config.toml`: el orquestador lee el archivo y construye la URL del API. Al ejecutar `dev:local`, esa URL se inyecta en el proceso de Next.js como `NEXT_PUBLIC_SUPABASE_URL`, sin editar ni imprimir archivos `.env`. Los puertos predeterminados `54321–54329` no se usan porque Windows los mantiene dentro de un rango reservado en este equipo.

La aplicación usa además el PostgreSQL independiente `nexus_bi_dev_local` en `127.0.0.1:55480` para sus marts mediante `SUPABASE_DB_URL`. Ese puerto no pertenece al stack de la CLI y el remapeo no lo modifica. Los helpers `db:disposable:setup` y `db:disposable:teardown` administran exclusivamente ese contenedor; no reemplazan el stack Supabase ni forman parte de `dev:local`.

### Estado y detención segura

Desde la raíz:

```bash
npx --no-install supabase status
docker ps
curl -v http://127.0.0.1:13321
```

- `Ctrl+C` termina Next.js y deja Supabase activo.
- Para detener Supabase conservando sus datos: `npx --no-install supabase stop`.
- No usar `supabase stop --no-backup`, `supabase db reset`, `docker compose down -v`, `docker volume rm` ni `docker system prune` sobre este entorno.

### Diagnóstico de conectividad local

1. Ejecutar `npm run dev:local` desde la raíz, no desde un directorio sin `supabase/config.toml`.
2. Confirmar Docker con `docker info` y el stack con `npx --no-install supabase status`.
3. Leer el puerto vigente en `supabase/config.toml` y confirmarlo, por ejemplo con `Test-NetConnection 127.0.0.1 -Port 13321`.
4. En Windows, revisar los rangos con `netsh interface ipv4 show excludedportrange protocol=tcp`, `netsh interface ipv6 show excludedportrange protocol=tcp` y los listeners con `Get-NetTCPConnection -State Listen`.
5. Si Windows reserva nuevamente el bloque, elegir un único bloque contiguo bajo que no esté excluido, dentro del rango dinámico ni ocupado. Cambiar solamente las propiedades de puerto equivalentes en `supabase/config.toml`, ejecutar `npx --no-install supabase stop` y luego `npx --no-install supabase start`. No eliminar reservas de Windows ni volúmenes Docker como flujo normal.

Una respuesta HTTP explícita —incluidos `401`, `403` o `404`— confirma que el servidor existe. `Connection refused` o timeout no lo confirman.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md) — capas RAW/PROCESSED/MARTS/GOLD, de DuckDB local a Postgres/Supabase.
- [Orden de ejecución del pipeline](docs/DATA_PIPELINE.md) — comandos, uno por uno, y el orquestador NEXUS V3.
- [Actualización manual de datos (NEXUS V3)](docs/data-refresh-runbook.md) — worker local vs GitHub Actions, cómo leer el estado de una corrida.
- [Runbook de liberación Supabase + Netlify](docs/RUNBOOK_SUPABASE_NETLIFY.md) — secuencia de despliegue y reglas inviolables.
- [Matriz de variables de despliegue](docs/DEPLOYMENT_VARIABLE_MATRIX.md) — qué variable vive en qué entorno.
- [Checklist de liberación](docs/DEPLOYMENT_RELEASE_CHECKLIST.md) — gates y evidencia requerida.
- [Decisiones de arquitectura (ADR)](docs/adr/) — el porqué de las decisiones que no son obvias leyendo el código.
