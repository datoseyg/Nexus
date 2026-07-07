# Business Rules Layer

Directorio centralizado de reglas de negocio, políticas de cálculo y entidades contractuales de EYG Nexus. Antes de esto, estas reglas vivían dispersas entre `data/config/` (calendario laboral, feriados, alias de identidad), `src/lib/` (fórmulas de confianza) y no había ningún lugar para contratos por cliente/técnico/equipo. Este directorio no reemplaza `data/config/` ni `data/curation/` todavía (ver más abajo) - es la fuente **preferida** para reglas nuevas desde ahora.

## Qué vive acá

- **`manifest.json`**: identidad y versión del set de reglas vigente (`rule_set_id`, `version`, `effective_from/to`, `status`). Un cambio de reglas que afecte cálculos ya publicados debería bumpear `version` y actualizar `last_reviewed_at`.
- **`entities/`**: contratos y catálogos - datos de negocio reales (quién tiene qué SLA, qué vida útil dice el fabricante, qué familia es cada repuesto). Cada uno tiene una plantilla `*.example.csv` con las columnas esperadas; el archivo real (sin `.example`) es opcional y lo completa el negocio a mano.
- **`policies/`**: reglas de cálculo - cómo se computan las cosas, no qué es cada cosa. Ej. `lifecycle-model-policy.json` (umbrales del motor de modelos estadísticos), `business-hours.json`/`holidays.example.json` (copiados desde `data/config/` como referencia, ver sección de migración).
- **`schemas/`**: JSON Schema mínimo (tipo + `required`) de cada entidad/policy, usado por `loaders/validate-business-rules.js` para detectar columnas faltantes/inesperadas antes de que lleguen a DuckDB.
- **`loaders/`**: `load-business-rules.js` (funciones que usa el pipeline para leer manifest/policy/entity) y `validate-business-rules.js` (`npm run business-rules:validate`).

## Entidad vs. política

- **Entidad** = un hecho de negocio versionable con `effective_from/to` (ej. "el cliente X tiene SLA nivel 2 desde el 2026-01-01"). Vive en `entities/`, se carga a DuckDB en el schema `rules` si existe el archivo real.
- **Política** = una regla de cálculo o configuración operativa (ej. "el modelo AUTO usa mediana si hay >=3 intervalos"). Vive en `policies/`, la consume directamente el código del pipeline (no se carga a DuckDB, se lee con `loadPolicy()`).

## Qué reglas son inputs de negocio

Todo lo que hay hoy en `entities/*.example.csv` (contratos de cliente/técnico/equipo, vida útil de fabricante, perfiles de uso, familias de repuesto) es un input que **debe completar el negocio** - el pipeline nunca inventa estos valores. Mientras solo exista el `.example.csv`, el cálculo correspondiente cae a "sin dato" (`NO_DATA`/cohorte no disponible), nunca a un valor de relleno.

## Cómo afectan los cálculos

- `business-rules/policies/lifecycle-model-policy.json` controla el motor de `src/models/lifecycle/*` (umbrales de n mínimo, grid de Weibull, `shrinkage_k`, orden de cohortes) - ver `docs/LIFECYCLE_PREDICTIVE_MODELS.md`.
- `entities/part_manufacturer_life.csv` y `entities/part_families.csv` (si existen) alimentan el prior de fabricante y el cohorte "misma familia de repuesto" del modelo de vida útil.
- `entities/client_contracts.csv`, `worker_contracts.csv`, `equipment_contracts.csv`, `equipment_usage_profiles.csv` **todavía no están conectados a ningún cálculo** (v1 solo los define/valida/carga a DuckDB) - quedan como base para SLA/exposición operativa en una iteración futura, documentado explícitamente para no prometer algo que no está implementado.

## Cómo versionar cambios

1. Editar el archivo real (nunca el `.example.csv`, que es la plantilla).
2. Si el cambio altera un cálculo ya publicado (ej. cambiar `shrinkage_k`), bumpear `version` en `manifest.json` y actualizar `last_reviewed_at`.
3. Correr `npm run business-rules:validate` y luego reconstruir la línea afectada (`npm run build:gold:equipment-lifecycle`, `npm run db:build`).
4. `status` pasa de `DRAFT` a `ACTIVE` cuando el negocio confirma los valores (hoy todo el set es `DRAFT` - los `.example.csv` no representan contratos reales).

## Qué archivos no deben tener secretos

Nada en `business-rules/` debe contener credenciales, tokens ni URLs privadas - son reglas de negocio y contratos comerciales, no configuración de infraestructura. Si un archivo real (`client_contracts.csv`, etc.) llegara a incluir información sensible de un contrato, no debe commitearse a un repo compartido sin revisión - mismo criterio que `.env`.

## Relación con `data/config/` y `data/curation/`

- **`data/config/`**: sigue siendo el fallback real leído hoy por `src/lib/business-hours.js` (calendario laboral/feriados de Trabajo Fuera de Horario) y por `src/resolvers/part-identity-resolver.js` (`part_identity_aliases.csv`). No se migran esos loaders en esta iteración - `business-rules/policies/business-hours.json` es solo una copia de referencia/documentación por ahora. Migrar el loader real es un paso futuro (ver `docs/BUSINESS_RULES_LAYER.md`).
- **`data/curation/`**: sigue siendo el mecanismo de corrección de datos ya normalizados (alias, overrides) - no se toca ni se duplica acá. `business-rules/` es sobre reglas/contratos de negocio, no sobre correcciones de calidad de dato.
