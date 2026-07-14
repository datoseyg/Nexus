# Arquitectura -EYG Nexus Local

## Filosofía: local/serverless-first

El pipeline corre completo en una máquina local (VS Code + Node.js), sin servidores físicos ni costos variables en Fase 1. Cada etapa es un script independiente que lee archivos de un directorio y escribe archivos en otro -no hay estado compartido en memoria entre etapas, ni base de datos intermedia. Esto es intencional: permite migrar cada etapa a una función serverless (Cloud Run, Cloudflare Workers, GitHub Actions, Google Apps Script) sin rediseñar la arquitectura, simplemente reemplazando "leer/escribir archivo local" por "leer/escribir objeto en storage".

## Las 4 capas

```
data/
├─ raw/          RAW -JSON crudo, tal como lo devuelve cada API
├─ processed/    PROCESSED -CSV normalizado por plataforma (una tabla por entidad)
├─ marts/        MARTS -vistas cruzadas entre plataformas (joins ya resueltos)
└─ gold/         GOLD -tablas finales listas para consumo BI
```

### RAW (`data/raw/<plataforma>/`)
Copia fiel de la respuesta HTTP de cada API, en JSON, con timestamp en el nombre de archivo. Nunca se transforma ni se limpia acá -es la fuente de verdad si algo sale mal más adelante. No se sube a git (`.gitignore`).

### PROCESSED (`data/processed/<plataforma>/`)
Un normalizador por plataforma (`src/normalizers/`) lee todo el RAW disponible, deduplica por ID, y produce tablas CSV planas (`DB_*`, `DIM_*`) con nombres de columna estables y tipos consistentes (fechas ISO, booleanos, números). Cada plataforma es independiente entre sí en esta capa -no hay joins todavía.

### MARTS (`data/marts/`)
Vistas que cruzan dos o más plataformas (`src/marts/`), con joins ya resueltos y métricas agregadas. Es la capa donde "Zendesk ↔ FieldBeat ↔ Dolibarr" se convierte en una sola fila por entidad de negocio (ej. una fila por ticket).

### GOLD (`data/gold/`)
Tablas finales, ya agregadas y con estados de calidad de dato calculados, pensadas para conectarse directo a una herramienta BI (Looker Studio, Power BI, Metabase, etc.) sin transformación adicional. Ver [GOLD_DATA_CONTRACT.md](GOLD_DATA_CONTRACT.md).

Todas las capas usan `src/lib/csv.js` (lectura/escritura de CSV) y `src/lib/http.js` / `src/lib/save-json.js` (miners) como utilidades compartidas.

## Las 3 fuentes y su rol conceptual

| Plataforma | Rol conceptual | Qué representa |
|---|---|---|
| **Zendesk** | Demanda / ticket | El cliente reporta un problema. Es el punto de entrada de todo el flujo de servicio. |
| **FieldBeat** | Ejecución técnica / reporte | Un técnico va a terreno, ejecuta el trabajo, y documenta qué hizo -incluyendo qué repuestos usó. |
| **Dolibarr** | Producto / repuesto / inventario | El catálogo canónico de productos y repuestos de la empresa (ref, barcode, inventario). |

El flujo de negocio real es: **un ticket Zendesk genera un trabajo → el trabajo se ejecuta y reporta en FieldBeat → el reporte menciona repuestos usados → esos repuestos deben identificarse contra el catálogo Dolibarr.**

El pipeline reconstruye esa cadena completa (`Ticket_FieldBeat_Dolibarr_Operational_View.csv`), pero la cadena depende de que cada eslabón esté bien enlazado con el siguiente. Ver [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md) para las limitaciones reales de ese enlace en GOLD v1.

## Estructura de directorios (`src/`)

```
src/
├─ run-all.js              Orquesta los 3 miners (Dolibarr, Zendesk, FieldBeat)
├─ lib/
│  ├─ http.js               getJson() + basicAuth() compartidos
│  ├─ csv.js                readCsv() / writeCsv() / csvEscape() compartidos
│  └─ save-json.js          saveJson() + timestampForFile() para RAW
├─ miners/                  1 archivo por plataforma: RAW -> data/raw/<plataforma>/
├─ normalizers/              RAW -> PROCESSED (data/processed/<plataforma>/)
├─ resolvers/
│  └─ part-identity-resolver.js   Cascada de resolución de identidad de repuestos
├─ marts/                    PROCESSED -> MARTS (cruces entre plataformas)
├─ qa/                       Auditorías: duplicados, coverage, reconciliación de alcance
└─ gold/
   └─ build-gold.js          MARTS + reportes de QA -> GOLD
```

Ver [DATA_PIPELINE.md](DATA_PIPELINE.md) para el orden exacto de ejecución de cada comando.

## Legacy: Cloudflare

Hubo un intento previo de migrar a Cloudflare (Workers/D1/Pages), congelado porque el paso siguiente (R2) exige tarjeta y el proyecto debe usar solo servicios cardless. Ese trabajo **no se borró** -vive completo en otras ramas de este mismo repo, sin tocar por la migración a Supabase:

| Rama | Contenido |
|---|---|
| `cloudflare-migration` | Backend: `apps/nexus-edge-pipeline/` con `wrangler.toml` + el pipeline completo portado a TypeScript (`src/domain/{normalizers,marts,gold,resolvers}/*.ts`) pensado para correr en Workers. |
| `cloud-d1-readonly` | Frontend: dashboards after-hours y equipment-lifecycle completos sirviendo desde D1 vía Cloudflare Pages Functions, más `business-rules/` (reglas de contrato/horario/lifecycle) y `data/curation/` (modelo de datos para alias de repuestos, overrides de tickets, y otras entidades de curación). Incluye `src/cloud/export-d1-seed.js`, el script que generó los seeds en `cloud/d1/seeds/`. |
| `cloud-smoke-test` | Snapshot de smoke test de despliegue, contenido similar a `cloud-d1-readonly`. |

`main` y `supabase-migration` (donde corre la migración a Supabase) nunca tuvieron mergeado ninguno de estos tres -son puntos de partida limpios, iguales entre sí. Si en el futuro se retoma la ruta Cloudflare, el código de referencia está en esas ramas, no hay que reconstruirlo desde cero.
