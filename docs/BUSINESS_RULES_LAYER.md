# Business Rules Layer

Ver también `business-rules/README.md` (la referencia operativa, vive junto al código). Este doc explica el diseño y por qué existe.

## Por qué existe

Antes de esta iteración, las reglas de negocio de Nexus BI estaban repartidas: calendario laboral y feriados en `data/config/`, fórmulas de confianza hardcodeadas en `src/lib/`, y ningún lugar para contratos por cliente/técnico/equipo ni vida útil de fabricante. Eso hacía difícil responder "¿de dónde sale este número?" o "¿qué pasa si cambio este umbral?". `business-rules/` centraliza todo eso en un único directorio versionable, sin migrar de golpe lo que ya funciona.

## Arquitectura

```
business-rules/
  README.md            operativo (qué es cada carpeta, cómo versionar)
  manifest.json         identidad del set de reglas vigente
  entities/              contratos y catálogos (*.example.csv + real opcional)
  policies/              reglas de cálculo (JSON, consumidas directo por el pipeline)
  schemas/               JSON Schema mínimo de cada entidad/policy
  loaders/               load-business-rules.js + validate-business-rules.js
```

## Entidades vs. políticas

- **Entidad**: un hecho de negocio con vigencia (`effective_from/to`) - "este cliente tiene este SLA". Se carga a DuckDB (`schema rules`) si existe el archivo real.
- **Política**: una regla de cálculo - "el modelo AUTO usa mediana si hay >=3 intervalos". Nunca se carga a DuckDB, la lee directo el código del pipeline vía `loadPolicy()`.

## Contratos como entidades

`entities/client_contracts.example.csv`, `worker_contracts.example.csv`, `equipment_contracts.example.csv`, `equipment_usage_profiles.example.csv` definen el esquema para cuando el negocio quiera declarar SLA, contratos de técnicos, perfiles de uso esperado, etc. En v1 **estas 4 entidades se cargan a DuckDB pero no alimentan ningún cálculo todavía** - son la base para una iteración futura que conecte SLA/exposición operativa al motor de modelos de vida útil (ver `docs/LIFECYCLE_PREDICTIVE_MODELS.md` § próximos pasos). `part_manufacturer_life.example.csv` y `part_families.example.csv` sí están conectadas: la primera alimenta el prior de fabricante del motor de modelos; la segunda está definida pero su cohorte "misma familia" no está implementada todavía (ver limitación explícita en `LIFECYCLE_PREDICTIVE_MODELS.md`).

## Versionado de reglas (`rule_set_id`)

`manifest.json` fija `rule_set_id`/`version`/`status`. Mientras `status` sea `DRAFT` (como hoy), ningún valor de `entities/*.example.csv` debe tratarse como dato real - son plantillas. Cuando el negocio confirme valores reales y se carguen los archivos sin `.example`, `status` pasa a `ACTIVE` y cualquier cambio posterior de un valor ya usado en un cálculo publicado debe bumpear `version`.

## Cómo afecta los cálculos

- `policies/lifecycle-model-policy.json` controla directamente `src/models/lifecycle/lifecycle-model-selector.js` (umbrales de n, grid de Weibull, `shrinkage_k`, prior de Gamma-Poisson, orden de cohortes).
- `policies/confidence-weights.json` controla `src/models/lifecycle/lifecycle-prediction-confidence.js` (pesos de los 9 factores + penalizaciones).
- `entities/part_manufacturer_life.csv` (si existe) alimenta el prior de fabricante en `src/gold/build-equipment-part-lifecycle-gold.js` - con fallback al legacy `data/config/manufacturer_life_specs.csv` de la iteración anterior.
- `policies/business-hours.json`/`holidays.example.json` son copias de referencia - el loader real de Trabajo Fuera de Horario (`src/lib/business-hours.js`) sigue leyendo `data/config/` en v1 (ver migración abajo).
- `policies/replacement-event-rules.json` y `policies/service-level-rules.json` son plantillas documentadas, todavía no conectadas a ningún script (`src/marts/build-equipment-part-lifecycle-events.js` sigue usando sus listas de keywords hardcodeadas).

## Migración desde `data/config/`

No es un corte limpio - es incremental:

1. **Hecho en esta iteración**: `business-rules/policies/business-hours.json` y `holidays.example.json` existen como copia de referencia/documentación. `data/config/` sigue siendo la fuente real que lee el código.
2. **Pendiente (próxima iteración)**: cambiar `src/lib/business-hours.js` para que lea primero `business-rules/policies/business-hours.json` y caiga a `data/config/` solo si no existe - análogo al patrón ya usado para `part_manufacturer_life` en el gold builder de vida útil.
3. `data/config/part_identity_aliases.csv` (alias manual de repuestos) **no se migra** - es corrección de dato normalizado, no una regla/política de negocio; sigue viviendo donde está.

## Qué sigue viviendo en `data/curation/`

`data/curation/` sigue siendo el mecanismo de corrección de datos ya normalizados (alias de cliente/equipo/repuesto, overrides de vínculo de ticket, correcciones de campo) - un concepto distinto de "regla de negocio". `business-rules/` no lo reemplaza ni lo duplica.

## Validación

```bash
npm run business-rules:validate
```

Genera `data/reports/business_rules_validation_summary.json` - compara encabezados de cada `.example.csv`/archivo real contra `business-rules/schemas/*.schema.json`, y confirma que cada policy tenga sus claves requeridas. No falla si falta un archivo real (son opcionales por diseño) - sí falla si falta un `.example.csv` (la plantilla siempre debe existir) o si un archivo real tiene columnas equivocadas.
