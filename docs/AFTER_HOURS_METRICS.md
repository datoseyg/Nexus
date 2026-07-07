# Trabajo Fuera de Horario

## Objetivo

Analizar cuánto del trabajo técnico registrado en FieldBeat cae **fuera de la ventana hábil configurada** (fuera de horario en día hábil, fin de semana, o feriado), con transparencia explícita sobre qué tan confiable es cada número. No reemplaza ni se inserta en el Dashboard Operacional - ver "Vista independiente" abajo.

## Vista independiente

`/dashboard/after-hours` ("Trabajo Fuera de Horario") es un módulo de navegación propio, separado de `/dashboard/operacional` y `/dashboard/fieldbeat`. Comparte convenciones de UI (`PageHeader`, `SectionCard`, `MetricCard`) pero tiene su propio mart (`marts.fieldbeat_working_hours_analysis`), sus propias tablas GOLD (`gold.after_hours_*`) y sus propios endpoints (`/api/dashboard/after-hours/*`). Ningún dato de esta vista se mezcla con las consultas del Dashboard Operacional.

## Horario hábil configurado

`data/config/business-hours.json` (versionado, no `.example`):

- Lunes a viernes, 08:30-18:30, zona horaria `America/Santiago`.
- Sábado y domingo: no hábiles.
- **`"status": "DEFAULT_UNVALIDATED"`** - este horario es un default razonable, **no ha sido validado con negocio**. Editar este archivo directamente para reflejar la política real de EyG.

`data/config/holidays.example.json` (`.example` - incompleto a propósito):

- Solo feriados chilenos de **fecha fija** (Año Nuevo, Día del Trabajo, Glorias Navales, Virgen del Carmen, Asunción, Independencia, Glorias del Ejército, Inmaculada Concepción, Navidad), generados 2018-2026.
- **Deliberadamente excluye** feriados movibles (Viernes Santo, Corpus Christi, Día de los Pueblos Indígenas, traslados a lunes de Encuentro de Dos Mundos e Iglesias Evangélicas, feriados "puente" declarados por ley cada año) - no se pueden calcular sin una fuente oficial año a año, y **no se inventan**.
- Para usar el calendario completo: crear `data/config/holidays.json` (sin `.example`) con `"status": "VALIDATED"` y la lista completa.

## Fuentes de datos

- `processed.fieldbeat_tasks`: `start_time` (UTC ISO) y `duration_minutes` - la fuente base de todas las tareas (3.747 en total).
- `processed.fieldbeat_report_fields`: campos "HORA DE INICIO DEL TRABAJO" / "HORA DE TERMINO DEL TRABAJO" del grupo `DESCRIPCIÓN DE LA INTERVENCIÓN` (formato `DD/MM/YYYY HH:mm`, hora local de Chile tal como la escribió el técnico) - la única fuente de una hora de término "real", cuando existe y es plausible (ver más abajo).
- `marts.fieldbeat_report_dolibarr_operational_view`: `client_name`, `client_rut`, `equipment_internal_ids` ya resueltos (reutilizados, no recalculados).

## Fórmula

Para cada tarea se resuelve un intervalo `[inicio, término)` y se particiona, día por día, en 4 categorías mutuamente excluyentes que suman exacto el total del intervalo:

```
business_minutes                = minutos dentro de la ventana hábil configurada
after_hours_weekday_minutes     = minutos fuera de la ventana, en un día hábil (madrugada/noche)
weekend_minutes                 = minutos en un día marcado no-hábil (sábado/domingo)
holiday_minutes                 = minutos en una fecha feriada
```

Rollup usado por los KPIs y `% fuera de horario`:

```
after_hours_total_minutes = after_hours_weekday_minutes + weekend_minutes + holiday_minutes
after_hours_rate          = after_hours_total_minutes / duración_usada
```

Por construcción, `business_minutes + after_hours_total_minutes` siempre iguala la duración usada → `after_hours_rate` nunca puede superar 1.

**Nota sobre la tabla de detalle:** la columna `after_hours` de la tabla (Parte 8) es específicamente `after_hours_weekday_minutes` (el residuo entre semana, fuera de ventana) - **no** el mismo número que "Horas fuera de horario" a nivel de KPI, que es el rollup de las 3 categorías combinadas. Ver `docs/CALCULATION_CONFIDENCE_MODEL.md` para la tabla completa de nombres.

## Exacto vs. estimado

Existen 6 métodos de cálculo (`calculation_method`), en orden de preferencia:

1. **`EXACT_REPORTED_START_END`** - existe un par HORA DE INICIO/TERMINO DEL TRABAJO reportado por el técnico **y pasa un filtro de plausibilidad** (fin > inicio, lapso ≤ 1 día calendario, y el lapso reportado no difiere de `duration_minutes` en más de `max(60 min, 50%)`). Se usa el intervalo reportado tal cual.
2. **`ESTIMATED_FROM_START_DURATION`** - no hay par reportado plausible, pero `start_time` y `duration_minutes` son válidos. Se estima `término = start_time + duration_minutes`.
3. **`PARTIAL_ESTIMATE`** - `duration_minutes` es sospechoso/extremo (menor a 5 min, 8+ horas, o exactamente 1440 min), o había un par reportado que **no pasó** el filtro de plausibilidad.
4. **`INVALID_START_TIME`** - `start_time` ausente o no parseable. No se puede calcular ningún intervalo.
5. **`INVALID_DURATION`** - `duration_minutes` ausente, cero o negativo. No se puede estimar un término.
6. **`INSUFFICIENT_DATA`** - fallback defensivo (no se observó en la práctica).

**Hallazgo importante:** al validar los pares reportados contra `duration_minutes` de la misma tarea, la mayoría **no describen la misma ventana** (ej. una tarea reporta un lapso de varios días mientras `duration_minutes` es de 2 horas - probablemente porque el técnico llenó el campo en otro momento, o por error de tipeo). El filtro de plausibilidad existe exactamente para no "lavar" esos datos hacia la categoría de mayor confianza. En consecuencia, `EXACT_REPORTED_START_END` aplica a una minoría de las tareas con reporte manual, no a la mayoría - esto es un resultado esperado, no un error.

Las tareas con método `INVALID_START_TIME`/`INVALID_DURATION`/`INSUFFICIENT_DATA` (`calculation_status = NOT_CALCULABLE`) **no se eliminan** del mart: quedan con horas en 0 y el motivo documentado en `calculation_notes`.

## Cómo se interpreta cada KPI

| KPI | Qué mide | Limitación principal |
|---|---|---|
| Horas totales registradas | `SUM(duration_minutes)/60` sobre todas las tareas | Depende de que `duration_minutes` esté bien cargado en FieldBeat |
| Horas hábiles estimadas | Minutos dentro del horario configurado | Depende del horario (aún `DEFAULT_UNVALIDATED`) y de tener un intervalo calculable |
| Horas fuera de horario | Minutos fuera del horario, cualquier motivo (noche/madrugada, fin de semana, feriado) | Igual que arriba, más la cobertura parcial de feriados |
| % fuera de horario | Horas fuera de horario ÷ horas totales | Hereda las limitaciones de las dos anteriores |
| Tareas con trabajo fuera de horario | `COUNT(is_after_hours_task)` | Depende de `start_time` y calendario |
| Tareas no calculables | `COUNT(calculation_status = NOT_CALCULABLE)` | Criterio determinístico - alta confianza en el conteo en sí |

Ningún KPI se presenta sin su `confidence_score`/`confidence_label` - ver `docs/CALCULATION_CONFIDENCE_MODEL.md`.

## Qué debe validar el negocio

1. **El horario hábil real de EyG** (¿08:30-18:30 Lun-Vie es correcto? ¿varía por equipo/cliente/contrato?) - hoy es un default sin validar.
2. **Si vale la pena sourcear un calendario de feriados chilenos completo** (incluyendo movibles) desde una fuente oficial año a año, en vez de solo fechas fijas.
3. **Si el criterio de plausibilidad del par reportado** (tolerancia `max(60 min, 50%)`) es razonable para el negocio, o si técnicos deberían recibir feedback para llenar mejor esos campos.
4. **Si la fusión de reportes multi-sesión** (tareas reabiertas varias veces, grupos "DESCRIPCIÓN DE LA INTERVENCIÓN (1)".."(9)") debería incorporarse - fuera de alcance en esta versión, solo se usa el grupo base.

## Limitaciones conocidas

- El horario hábil es un default, no una política validada.
- El calendario de feriados solo cubre fechas fijas (ver arriba).
- Reportes multi-sesión (visitas reabiertas) no se fusionan - solo se usa el primer grupo de intervención.
- La hora de término reportada por el técnico, cuando existe, describe con frecuencia una ventana distinta a `duration_minutes` (ver "Exacto vs. estimado") - se descarta si no pasa el filtro de plausibilidad, nunca se usa a ciegas.
- No existe forma de saber, a partir de estos datos, si una tarea "fuera de horario" fue una decisión operativa deliberada (ej. mantención nocturna programada) o una urgencia - eso requiere contexto que FieldBeat no captura estructuradamente hoy.
