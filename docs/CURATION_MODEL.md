# Modelo de curación de datos - EYG Nexus Local

Cómo se corrigen datos mal ingresados **sin editar nada directamente** - ni RAW, ni PROCESSED, ni MARTS, ni GOLD. Este documento define el modelo; la implementación real (aplicar las reglas dentro de los normalizers/resolver, y la UI del Centro de Correcciones) queda para una fase posterior - ver [PRODUCT_APP_ARCHITECTURE.md](PRODUCT_APP_ARCHITECTURE.md) y "qué queda fuera de Fase 1" ahí mismo.

## Principio central: RAW es inmutable, todo lo demás es reconstruible

```
RAW (inmutable) → PROCESSED → MARTS → GOLD → DuckDB
                       ↑           ↑        ↑
                       └── reglas de curation (data/curation/) ──┘
```

- **RAW nunca se toca.** Es la copia fiel de lo que cada API devolvió. Si un técnico tipeó mal un dato, ese error queda registrado en RAW para siempre - es historia, no se reescribe.
- **PROCESSED, MARTS y GOLD son 100% reconstruibles** desde RAW + las reglas de curation vigentes, corriendo el pipeline (`npm run get:... / normalize:... / build:...`). Nunca se edita un CSV de estas capas a mano - cualquier edición manual se pierde en el siguiente rebuild.
- **Las correcciones se guardan como reglas**, no como parches puntuales a un dato. Una regla vive en `data/curation/*.csv` y se aplica automáticamente cada vez que el pipeline corre - hoy manualmente vía normalizers/resolver (ver "Dónde se aplica cada regla" abajo), en el futuro también desde la UI del Centro de Correcciones.

## Por qué reglas y no ediciones directas

Si se editara un dato directamente en `DB_FieldBeat_Used_Parts.csv`, esa corrección **se perdería la próxima vez que se corra `npm run normalize:fieldbeat`** (el archivo se regenera completo desde RAW). Además, una corrección casi nunca es "un dato puntual" - normalmente es un **patrón** que se repite: si un técnico escribió "CLINICA ALEMANA" en vez de "CLINICA ALEMANA DE SANTIAGO" una vez, probablemente lo escribió así muchas veces, en el pasado y en el futuro. Una regla de alias resuelve todas esas ocurrencias de una vez, de forma consistente, y sigue resolviendo las que aparezcan en futuras cargas de datos - no hay que acordarse de corregir "ese ticket específico" cada vez.

## Una corrección puede afectar múltiples registros, históricos y futuros

Este es el punto que distingue una regla de curation de un simple "editar una celda":

- **Histórico:** un alias de cliente (`client_aliases.csv`) aplicado hoy corrige TODAS las tasks FieldBeat pasadas que usaron esa variante del nombre, no solo la que motivó la corrección.
- **Futuro:** si el mismo técnico vuelve a escribir la variante incorrecta en un reporte nuevo, la regla ya existente la resuelve automáticamente en el próximo rebuild - no hace falta crear la regla de nuevo.
- Por esto, **antes de guardar una regla la UI debe mostrar un preview de impacto**: cuántos registros (tasks, repuestos, tickets) se verían afectados si la regla se aplica ahora. Ver sección siguiente.

## Campos obligatorios en toda corrección

Las 7 tablas de `data/curation/` (ver `.example.csv` de cada una) comparten estos campos como mínimo:

| Campo | Obligatorio | Para qué |
|---|---|---|
| `created_by` | Sí | Quién propuso/aprobó la regla - trazabilidad de responsabilidad. |
| `created_at` | Sí | Cuándo se creó - ISO 8601. |
| `reason` | Sí | Por qué se creó esta regla - texto libre, pero nunca vacío. Sin esto, una regla de 6 meses después es indescifrable. |

Ninguna regla debería poder guardarse sin estos 3 campos completos - la validación de esto (cuando exista la UI) debe ser dura, no una sugerencia.

## Preview de impacto antes de guardar

Antes de persistir cualquier regla nueva, la UI (cuando se construya) debe ejecutar una query de "cuántos registros calzan con esta regla HOY" contra el warehouse actual y mostrar el número al usuario - por ejemplo, para un alias de cliente: `SELECT COUNT(*) FROM processed.fieldbeat_tasks WHERE client_key = '<alias>'`. Esto evita que alguien cree una regla que no hace nada (0 registros afectados, probablemente un error de tipeo en la propia regla) o una regla demasiado amplia (afecta miles de registros sin querer, ej. un `CONTAINS` mal pensado en `placeholder_rules.csv`).

## Al guardar, ejecutar o recomendar rebuild

Una regla de curation **no tiene efecto hasta que el pipeline se vuelve a correr** - no hay aplicación en caliente sobre el warehouse actual. Por eso, al guardar una regla, la UI debe:
1. Registrar la regla en el CSV de curation correspondiente.
2. Registrar el evento en `curation_audit_log.csv` (qué se creó, impacto estimado, quién, por qué).
3. Ofrecer ejecutar el rebuild correspondiente ahí mismo (mínimo: la etapa que consume esa regla; máximo: `npm run db:build` completo), o marcarlo como pendiente si el usuario prefiere acumular varias correcciones antes de reconstruir.

## Las 7 tablas de curation

Ver plantillas reales en `data/curation/*.example.csv`.

| Archivo | Corrige | Aplicaría en (futuro) |
|---|---|---|
| `client_aliases.csv` | Variantes de nombre de cliente FieldBeat | `src/normalizers/fieldbeat-normalizer.js` (remapeo de `client_key`/`client_name`) |
| `equipment_aliases.csv` | Variantes de `equipment_internal_id` | `src/normalizers/fieldbeat-normalizer.js` (remapeo de equipos) |
| `part_identity_aliases.csv` | Repuestos sin match o ambiguos contra Dolibarr | `src/resolvers/part-identity-resolver.js` (ya tiene el hook - hoy lee `data/config/part_identity_aliases.csv`, ver nota de migración abajo) |
| `ticket_link_overrides.csv` | Tickets Zendesk mal reportados o "fantasma" por FieldBeat | `src/marts/build-fieldbeat-report-dolibarr-view.js` / `build-ticket-fieldbeat-view.js` (override de `zendesk_join_status`) |
| `report_field_corrections.csv` | Valores de texto libre mal ingresados en el formulario técnico | `src/normalizers/fieldbeat-normalizer.js` (al construir `DB_FieldBeat_Report_Fields.csv` / `DB_FieldBeat_Used_Parts.csv`) |
| `placeholder_rules.csv` | Lista de valores "no es un dato real" (hoy hardcodeada en JS) | `src/resolvers/part-identity-resolver.js` (reemplazaría el array `PLACEHOLDER_LITERALS`) |
| `curation_audit_log.csv` | No corrige nada - es el log maestro de todas las correcciones aplicadas | Ninguno (tabla de solo lectura / auditoría) |

### Nota de migración: `part_identity_aliases`

Ya existe `data/config/part_identity_aliases.example.csv` (Sprint 4) y el resolver (`src/resolvers/part-identity-resolver.js`) ya lo lee desde ahí. `data/curation/part_identity_aliases.example.csv` (este documento) tiene el mismo propósito pero con el schema de curation completo (`created_by`/`created_at` agregados). **Todavía no se migró el resolver a leer desde `data/curation/`** - es un paso pendiente explícito, no un descuido, para no romper el flujo ya probado de Sprint 4 sin una migración deliberada. Hasta que se haga esa migración, `data/config/` sigue siendo la ruta real que usa el pipeline.

## Qué NO permite este modelo (a propósito)

- No permite editar RAW, PROCESSED, MARTS o GOLD directamente - ni desde la UI futura ni a mano.
- No aplica una regla "en caliente" sin rebuild - evita que el warehouse y los CSV queden desincronizados.
- No genera movimientos de stock en Dolibarr bajo ninguna circunstancia - la curación de repuestos solo corrige la *identificación* del repuesto, nunca toca inventario.
