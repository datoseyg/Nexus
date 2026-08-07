# DEPLOY-REBASELINE — fuentes oficiales de Netlify, OpenNext y Supabase

Fecha de consulta: 2026-07-20

Alcance: investigación documental de la integración Next.js/Netlify, configuración de monorepo, variables de entorno, conectividad PostgreSQL de Supabase y controles de preview/producción/rollback.

Restricción aplicada: no se desplegó, no se ejecutó SQL ni se modificó ningún sistema remoto.

## 1. Snapshot local usado para aplicar las fuentes

Estos son hechos observados directamente en el repositorio, no afirmaciones de la documentación externa:

- Rama local: `Control-Acceso`.
- Commit `HEAD`: `6a699960ed038ae395c73057f98b515c5a667321`.
- `apps/nexus-bi-app/package.json` declara Next.js `^16.2.10` y el build `next build`.
- Al inicio de la auditoría, `netlify.toml` estaba en la raíz y declaraba:
  - `base = "apps/nexus-bi-app"`;
  - `command = "npm run build"`;
  - `publish = ".next"`;
  - `[[plugins]] package = "@netlify/plugin-nextjs"`.
- No existe `apps/nexus-bi-app/netlify.toml`.
- Ni el `package.json` raíz ni el de la app declaran `@netlify/plugin-nextjs` como dependencia.
- El repositorio no está configurado como npm workspace: la raíz y `apps/nexus-bi-app` son paquetes npm separados.
- El runtime PostgreSQL de la app lee `SUPABASE_DB_URL`, crea un `pg.Pool` con máximo cinco conexiones y espera explícitamente el transaction pooler en puerto 6543.
- Los scripts administrativos de migración y validación leen `SUPABASE_DB_URL_DIRECT`; la migración ejecuta `TRUNCATE ... RESTART IDENTITY CASCADE` antes de recargar las tablas gestionadas.

## 2. Next.js vigente en Netlify: OpenNext y referencia legacy

### Hechos oficiales

Netlify documenta que Next.js moderno se ejecuta mediante su adaptador OpenNext y que este se aplica automáticamente. El adaptador provisiona Functions para SSR, ISR, Route Handlers y Server Actions, además de una Edge Function para Middleware. Netlify recomienda no fijar manualmente la versión del adaptador. Fuente: [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).

Para Next.js 13.5 o posterior, Netlify indica expresamente eliminar tanto la dependencia como el bloque `[[plugins]]` de `@netlify/plugin-nextjs`. Agregar o conservar ese plugin fija una versión y vuelve al sistema legacy, excluyendo las actualizaciones automáticas y mejoras de OpenNext. Fuente: [Upgrading or reverting the Next.js adapter](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/legacy-runtime/upgrading-or-reverting-adapter/).

La referencia de frameworks de Netlify lista `npm run build` y `.next` como los valores típicos de build y publish para Next.js. Fuente: [Frameworks on Netlify](https://docs.netlify.com/frameworks/).

### Inferencia aplicada a este repositorio

Next.js 16.2.10 está dentro del camino moderno. El bloque `[[plugins]] package = "@netlify/plugin-nextjs"` del `netlify.toml` raíz es una referencia legacy y debe retirarse. No debe agregarse el paquete a `package.json`: dejarlo sin fijar permite que Netlify aplique su adaptador OpenNext vigente automáticamente.

La verificación posterior no debe asumir una versión concreta del adaptador. Debe comprobar en el log de un futuro Deploy Preview que Netlify detectó Next.js y aplicó OpenNext, porque la propia plataforma selecciona la versión en cada build.

## 3. Configuración del monorepo

### Hechos oficiales

Netlify define:

- **Base directory**: directorio donde busca archivos de gestión de dependencias, instala dependencias, cachea y ejecuta el build. Si no se define, es la raíz.
- **Package directory**: directorio que contiene los archivos del sitio; se usa cuando es diferente de Base y solo puede configurarse en la UI.
- **Build command**: se ejecuta desde Base.
- **Publish directory**: es relativo a Base y contiene los artefactos que se publican.

Netlify busca `netlify.toml` primero en Package, luego en Base y finalmente en la raíz. Una Base declarada en un `netlify.toml` raíz prevalece sobre la configuración de Base de la UI. Fuentes: [Monorepos](https://docs.netlify.com/build/configure-builds/monorepos/) y [Create deploys](https://docs.netlify.com/deploy/create-deploys/).

La recomendación general de Netlify para un monorepo es Base en la raíz y Package en la subcarpeta del sitio, dejando la gestión de dependencias al package manager. La misma documentación aclara que Package se usa si los archivos del sitio están en un lugar diferente de Base.

### Inferencia aplicada a este repositorio

Este repositorio no es un npm workspace y el `package.json` raíz no contiene las dependencias de la app. Por eso, aplicar literalmente la recomendación general —Base raíz y Package `apps/nexus-bi-app`— introduciría una interfaz de build más compleja: exigiría convertir la raíz en workspace o usar comandos e instalación dirigidos manualmente a la subcarpeta.

La configuración determinista y mínima para el estado actual es:

| Campo Netlify | Valor aplicado | Motivo |
|---|---|---|
| Base directory | `apps/nexus-bi-app` | Allí están el `package.json`, lockfile, dependencias y fuente de la única app desplegable. |
| Package directory | vacío/no configurado | Package no difiere de Base; no existe configuración propia adicional en otra subcarpeta. |
| Build command | `npm run build` | Se ejecuta desde Base y llama a `next build`. |
| Publish directory | `.next` | Es relativo a Base y es el output reconocido para Next.js/OpenNext. |
| Archivo de configuración | `netlify.toml` raíz | Ya representa a la única app desplegable; su `base` fija el contexto correcto. |

Esta opción conserva una interfaz de despliegue pequeña: una sola Base determina instalación, build y resolución de `.next`. Si en el futuro se convierte la raíz en un workspace real o se agregan más sitios, debe reconsiderarse Base raíz + Package por sitio y mover cada `netlify.toml` junto a su Package, siguiendo la recomendación general de Netlify.

## 4. Variables durante build y Functions

### Hechos oficiales

Netlify separa variables por alcance. `Builds` hace que estén disponibles durante el build y compilación de Functions. `Functions` hace que estén disponibles en ejecución. En planes que admiten scopes, una variable que necesite ambos momentos debe incluir ambos. Fuentes: [Environment variables overview](https://docs.netlify.com/build/environment-variables/overview/), [Build environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/) y [Environment variables and serverless functions](https://docs.netlify.com/build/functions/environment-variables/).

Las variables declaradas en `netlify.toml` no están disponibles durante el runtime de Functions. Netlify recomienda guardar secretos mediante UI, CLI o API; el archivo de configuración está versionado y no debe contener valores sensibles. Un cambio de variables requiere un nuevo deploy para aplicarse a las Functions.

Los valores pueden separarse por contexto: Production, Deploy Previews, Branch deploys, Preview Server y desarrollo local. La plataforma permite valores específicos por rama. Fuente: [Deploy contexts](https://docs.netlify.com/deploy/deploy-overview/#deploy-contexts).

### Inferencia aplicada a este repositorio

Matriz de scopes mínimos para la app:

| Variable | Builds | Functions | Exposición | Aplicación en el repo |
|---|:---:|:---:|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sí | sí | pública | Next.js la incorpora al cliente; proxy y clientes server también la consumen. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | sí | sí | pública | Clave publicable de Auth; no es un secreto. |
| `SUPABASE_DB_URL` | no | sí | secreto | Runtime `pg` de Route Handlers/Server Components; debe ser transaction pooler, puerto 6543. |
| `DATABASE_SSL_MODE` | no | sí | configuración server-only | En Supabase debe permanecer `require` o puede omitirse porque el código usa ese default. |
| `NEXUS_AUTH_GERENCIA_EMAIL` | no | sí | dato server-only sensible | Resuelve el identificador público `GERENCIA` a la cuenta técnica. |
| `NEXUS_AUTH_ADMINISTRACION_EMAIL` | no | sí | dato server-only sensible | Resuelve `ADMINISTRACION` a la cuenta técnica. |
| `NEXUS_ADMIN_TOKEN` | no | sí | secreto | Protege exclusivamente `/api/admin/**`. |
| `NEXUS_SHOW_AUDIT` | no | sí | configuración server-only | Mantener `false` en la primera liberación. |
| `NEXUS_SHOW_EXPLORER` | no | sí | configuración server-only | Mantener `false` en la primera liberación. |

`NEXT_PUBLIC_*` debe tener valores distintos para preview y producción si cada contexto usa un proyecto Supabase distinto. `SUPABASE_DB_URL`, identidades técnicas y token administrativo también deben ser contextuales y nunca reutilizar credenciales productivas en preview.

Las variables administrativas `SUPABASE_DB_URL_DIRECT`, `CONFIRM_WRITE_TARGET`, `CONFIRM_PROTECTED_WRITE_TARGET` y `LOAD_RAW` no pertenecen a Netlify. Deben existir únicamente en el entorno local/CI administrativo autorizado que ejecutará DDL o sincronización.

Supabase confirma que las claves `service_role` y las nuevas claves secretas omiten RLS y no son seguras en frontend. Fuente: [Securing your data](https://supabase.com/docs/guides/database/secure-data). En este repositorio tampoco son necesarias para el runtime, porque Auth usa una publishable key y los datos usan el rol PostgreSQL `nexus_app`. Por defensa en profundidad, no debe definirse ningún `SUPABASE_SERVICE_ROLE_KEY`, `service_role` ni `sb_secret_*` en el proyecto Netlify, incluso con scope Functions.

## 5. Conexiones PostgreSQL de Supabase

### Hechos oficiales

Supabase distingue tres caminos relevantes. Fuente principal: [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres); corroboración de red: [Supabase and IPv4/IPv6 compatibility](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP).

| Camino | Host/puerto típico | Red | Uso oficial recomendado | Limitaciones relevantes |
|---|---|---|---|---|
| Direct connection | `db.<project-ref>.supabase.co:5432` | IPv6 por defecto; IPv4 con add-on | Backends persistentes, migraciones, `pg_dump`, backup y herramientas administrativas | El host ejecutor debe alcanzar IPv6 si no hay add-on. |
| Shared session pooler | `aws-<region>.pooler.supabase.com:5432` | IPv4 | Fallback para sesiones persistentes desde redes sin IPv6 | Cada cliente retiene una conexión subyacente durante su sesión; menos multiplexación. |
| Shared transaction pooler | `aws-<region>.pooler.supabase.com:6543` | IPv4 | Serverless/edge y conexiones transitorias | No admite prepared statements; la librería debe desactivarlas/no usarlas. |

Supabase explica que session mode asigna una conexión directa subyacente exclusivamente a cada conexión cliente, mientras transaction mode puede compartir conexiones entre clientes por transacción. Fuente: [Supavisor and connection terminology](https://supabase.com/docs/guides/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO).

Las restricciones de red de Supabase se aplican tanto a conexiones directas como pooled; si se habilitan, las allowlists deben contemplar las familias IP correspondientes. Fuente: [Network restrictions](https://supabase.com/docs/guides/platform/network-restrictions).

### Inferencia aplicada a este repositorio

- **Runtime Netlify:** `SUPABASE_DB_URL` debe usar el transaction pooler IPv4 en puerto 6543 con el rol de mínimos privilegios `nexus_app`. La app usa consultas de `pg` sin nombres de prepared statement, por lo que no depende de prepared statements de sesión. El límite local de cinco conexiones sigue siendo un techo por instancia de Function, no un techo global del sitio.
- **DDL, migración y validación desde un host con IPv6:** `SUPABASE_DB_URL_DIRECT` debe usar la conexión directa en puerto 5432 y el rol administrativo previsto por los scripts.
- **Fallback administrativo si el host no alcanza IPv6:** sustituir temporalmente el host directo por el session pooler IPv4 en puerto 5432, conservando el rol administrativo y realizando primero una prueba de conexión de solo lectura. No usar el transaction pooler para DDL/migraciones que puedan depender de estado de sesión.
- **No promover el fallback a runtime:** session pooler soluciona conectividad IPv4 para tareas persistentes, pero no ofrece la multiplexación adecuada para la ráfaga de instancias serverless.

Las URLs completas son secretos porque contienen credenciales. El runbook debe enseñar a copiarlas desde **Connect** en Supabase, pero nunca incluir ejemplos con proyecto, usuario o password reales.

## 6. Preview, producción y rollback

### Hechos oficiales

Netlify distingue Production deploy, Deploy Preview y Branch deploy. Los Deploy Previews se generan normalmente desde pull/merge requests; los Branch deploys proporcionan una URL estable por rama. Los valores de variables pueden ser específicos por contexto o por rama. Fuentes: [Deploy overview](https://docs.netlify.com/deploy/deploy-overview/) y [Compare preview options](https://docs.netlify.com/deploy/compare-preview-options/).

La production branch es configurable y sus deploys reemplazan la versión publicada si auto-publishing está habilitado. Netlify también permite bloquear el deploy publicado para detener auto-publishing mientras sigue construyendo nuevos deploys. Fuente: [Manage deploys](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/).

Los deploys son atómicos. Un rollback publica instantáneamente un deploy exitoso anterior sin reconstruirlo. Si auto-publishing sigue activo, un deploy posterior de la rama de producción volverá a reemplazar ese rollback. El rollback de código no revierte automáticamente el estado de una base de datos. Fuentes: [Manage deploys — Rollbacks](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/#rollbacks) y [Backup and recovery](https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/).

Netlify permite exigir que la publicación productiva ocurra solo mediante el flujo Git hacia la production branch. Fuente: [Git workflows overview](https://docs.netlify.com/build/git-workflows/overview/).

### Inferencia aplicada a este repositorio

- Configurar `main` como production branch.
- Usar `Frontend-Rev` como Branch deploy/preview estable previo a producción, con valores no productivos y cuentas Auth de prueba.
- No ejecutar un smoke de escritura contra producción. El smoke productivo debe limitarse a login/logout, redirects, `401`/`403`, lectura autorizada y comprobación de identidad/flags.
- Antes de publicar `main`, bloquear auto-publishing o exigir publicación por Git y conservar el ID del último deploy sano.
- Rollback de frontend: volver a publicar el deploy anterior desde Netlify y mantener el sitio bloqueado hasta identificar la causa.
- Rollback de datos/schema: es un procedimiento separado. No debe inferirse de un rollback Netlify y requiere backup/restore o una migración compensatoria previamente diseñada y autorizada.
- Debido a que la sincronización actual usa `TRUNCATE ... CASCADE`, jamás debe ejecutarse como parte automática del build o deploy de Netlify. Debe ser un gate administrativo separado, contra un destino verificado y con respaldo.

## 7. Secuencia respaldada por las fuentes

La secuencia segura aplicada al proyecto es:

1. **Local:** typecheck, tests, integración sobre PostgreSQL desechable, build y smoke sin sesión/con sesión usando configuración local.
2. **Supabase autorizado:** ejecutar DDL y sincronización desde un entorno administrativo, por conexión directa IPv6 o session-pooler fallback; validar estructura y datos antes de avanzar.
3. **Auth:** crear/configurar las cuentas y claims autorizados, verificar expiración, renovación y logout con Supabase real.
4. **Preview:** Branch deploy `Frontend-Rev`, variables de contexto no productivas, OpenNext confirmado en logs y smoke exclusivamente no destructivo.
5. **Producción:** merge a `main`, publicación controlada y smoke de solo lectura.

Cada transición es un gate independiente. Un fallo detiene la secuencia; no se compensa saltando al ambiente siguiente.

## 8. Conclusiones para el rebaseline

1. `@netlify/plugin-nextjs` debe eliminarse de `netlify.toml`; Netlify aplicará OpenNext automáticamente.
2. Para el layout npm actual, Base `apps/nexus-bi-app`, Package sin configurar, build `npm run build` y publish `.next` forman la configuración coherente.
3. Las variables de Functions deben configurarse en Netlify UI/CLI/API, no dentro de `netlify.toml`, y separarse por contexto.
4. El runtime debe conservar transaction pooler; direct IPv6 queda para administración y session pooler es el fallback IPv4 administrativo.
5. Preview y producción requieren credenciales/datos separados. `Frontend-Rev` precede a `main`.
6. El rollback Netlify restaura código desplegado, no PostgreSQL. DDL, `TRUNCATE`, migraciones y restores necesitan autorización y procedimiento propios.
7. Ninguna clave `service_role` o `sb_secret_*` debe existir en Netlify para esta arquitectura.
