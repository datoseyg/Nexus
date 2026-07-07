# Vida Útil de Repuestos por Máquina - metodología

Documento de referencia para la línea "Vida Útil de Repuestos por Máquina" (`/dashboard/equipment-lifecycle`). Complementa [CALCULATION_CONFIDENCE_MODEL.md](CALCULATION_CONFIDENCE_MODEL.md) (modelo de confiabilidad general) y [DATA_PIPELINE_MAP.md](DATA_PIPELINE_MAP.md) (mapa de las 4 líneas del pipeline).

> **Las estimaciones no reemplazan especificaciones del fabricante ni garantías contractuales. Son evidencia operacional observada en los datos de E&G.**

## Objetivo de la vista

Permitir, por máquina, ver qué repuestos se le han cambiado/usado históricamente, cada cuánto, y con qué confiabilidad se puede sostener esa cifra - como insumo para mantenimiento predictivo preliminar y para argumentar frente a un cliente con evidencia (no con una promesa de precisión).

## Vida útil real vs. observada vs. estimada

- **Vida útil real**: cuánto dura efectivamente un repuesto en una máquina específica. Nunca la conocemos con certeza total - solo la inferimos.
- **Vida útil observada**: el intervalo de tiempo que efectivamente medimos entre dos eventos consecutivos de uso/cambio del mismo repuesto en la misma máquina, según los reportes FieldBeat disponibles. Es un dato, no una inferencia - pero puede estar sesgado por lo que no se reportó.
- **Vida útil estimada**: el número que mostramos como "vida útil" de un repuesto en una máquina, calculado a partir de las vidas útiles observadas (normalmente la mediana de los intervalos). Es la mejor lectura disponible con los datos actuales, con su score de confiabilidad explícito.

## Qué se considera "evento de cambio"

Un evento es una fila de `marts.equipment_part_lifecycle_events`: la combinación de una task FieldBeat + un equipo asociado a esa task + un repuesto usado en esa task, con match confirmado contra Dolibarr (`match_status = MATCHED`). No es necesariamente un reemplazo físico confirmado - es la mejor lectura disponible de "este repuesto aparece usado en este reporte, en esta máquina, en esta fecha". `event_type_inferred` clasifica el evento (`CORRECTIVE_REPLACEMENT_LIKELY`, `PREVENTIVE_REPLACEMENT_LIKELY`, `CONSUMABLE_USAGE`, `PART_USAGE_CONFIRMED`, `UNKNOWN`) según keywords en el tipo de tarea y el nombre del repuesto - es una heurística de texto (ver listas de keywords en `src/marts/build-equipment-part-lifecycle-events.js`), no un clasificador entrenado, y se documenta como tal.

## Fuentes usadas

- `processed.fieldbeat_tasks` - fecha (`start_time`) y tipo de tarea.
- `processed.fieldbeat_task_equipments` - qué equipo(s) estaban asociados a la task.
- `processed.fieldbeat_used_parts` - qué repuesto(s) se usaron en la task.
- `marts.used_parts_dolibarr_match` - identidad de repuesto ya resuelta contra Dolibarr (ver `src/resolvers/part-identity-resolver.js`).
- `marts.fieldbeat_report_dolibarr_operational_view` y `marts.fieldbeat_working_hours_analysis` - enriquecimiento (cliente, técnico, horas de operación) cuando existen.

Solo se usan repuestos con `match_status = MATCHED` para el cálculo principal de intervalos y vida útil - el resto (`NO_MATCH`, `AMBIGUOUS_MATCH`, `PLACEHOLDER_VALUE`) queda visible en el mart de eventos para trazabilidad, pero no alimenta ninguna estimación.

## Qué significa "intervalo entre reemplazos"

`marts.equipment_part_lifecycle_intervals` tiene 1 fila por par de eventos consecutivos del mismo repuesto (`dolibarr_ref`) en la misma máquina (`equipment_internal_id`), ordenados por fecha. `interval_days` es la diferencia en días entre esos dos eventos. Si una máquina-repuesto solo tiene 1 evento observado, no hay intervalo que calcular - se emite igual una fila con `interval_status = SINGLE_EVENT_ONLY` para no hacer desaparecer esa combinación silenciosamente.

## Por qué se usa mediana (y cuándo promedio)

La mediana es más robusta a valores extremos (un solo intervalo de 3 años por una intervención mal registrada no debería duplicar la "vida útil estimada"). Se usa como método principal (`estimated_life_method = MEDIAN_INTERVAL`) cuando hay al menos 1 intervalo válido. El promedio (`avg_interval_days`) se muestra siempre como referencia adicional, junto a mínimo, máximo, percentiles 25/75 y desviación estándar - para que quien lea la tabla vea la dispersión completa, no solo un número. Los intervalos marcados `OUTLIER_CANDIDATE` (regla 1.5×IQR) **no se eliminan automáticamente** del cálculo - se marcan para que quien analiza decida si son un dato real (ej. la máquina estuvo mucho tiempo sin uso) o un error de registro.

## Qué es la tasa de reemplazo anual

`replacement_rate_per_year = 365.25 / estimated_life_days`. Es una forma de leer la misma estimación en "reemplazos esperados por año" en vez de "días de vida útil" - útil para proyectar consumo/costo anual de un repuesto en una máquina, con la misma incertidumbre que la estimación de la que parte.

## Qué es la incertidumbre / confianza metodológica

`src/lib/lifecycle-confidence.js` calcula un score 0-100 (`lifecycle_confidence_score`) a partir de 7 factores: cantidad de eventos/intervalos, calidad del match Dolibarr, claridad de la asociación máquina-repuesto (task con 1 vs. varios equipos), cobertura temporal, consistencia estadística (coeficiente de variación), disponibilidad de datos de horas de operación, y robustez del método de estimación usado. Usa los mismos tiers que el resto de Nexus BI (85-100 Alta, 65-84 Media, 40-64 Baja, 0-39 Insuficiente - ver [CALCULATION_CONFIDENCE_MODEL.md](CALCULATION_CONFIDENCE_MODEL.md)).

**Este score no es una probabilidad estadística.** Es una medida de confiabilidad metodológica basada en cantidad, calidad y trazabilidad de los datos usados para el cálculo - no la probabilidad de que el número sea "correcto". Nunca se presenta como garantía de certeza.

## Qué NO se puede inferir todavía

- No hay confirmación de que un evento sea un reemplazo físico real (podría ser una revisión, una limpieza, o un registro duplicado del mismo repuesto).
- No hay horas reales de uso del equipo (ciclos, disparos, horas de operación del equipo médico) - solo horas de la *visita técnica*, que no es lo mismo que uso del repuesto.
- No hay curva de supervivencia ni intervalo de confianza estadístico formal - la mediana/percentiles son descriptivos, no un modelo probabilístico ajustado.
- No hay dato de especificación de fabricante cargado por defecto (`manufacturer_life_months` queda vacío salvo que se complete `data/config/manufacturer_life_specs.csv`, ver `.example.csv`) - no se inventa este valor.
- No se prueba causalidad en ningún insight (ej. "alta actividad fuera de horario" es una correlación mencionada, no una causa demostrada).

## Por qué un cliente puede diferir de otro

`GOLD_Equipment_Part_Lifecycle_By_Client.csv` agrega el mismo repuesto por cliente (a través de sus máquinas) y `GOLD_Equipment_Part_Lifecycle_By_Part.csv` lo agrega globalmente. Diferencias entre clientes pueden deberse a: intensidad de uso real del equipo, calidad del mantenimiento previo, condiciones ambientales, calidad de registro del técnico (menos completitud de datos → menor confiabilidad, no necesariamente menor vida útil real), o simplemente menos historial disponible para ese cliente. La vista compara pero no explica la causa - eso requiere contexto operativo que no está en estos datos.

## Cómo se podrían incorporar horas reales de operación

Si en el futuro FieldBeat o el equipo médico exponen horómetros/ciclos reales, se podría reemplazar `interval_days` por "horas/ciclos reales entre reemplazos" para una vida útil basada en uso real y no en tiempo calendario - mucho más preciso para equipos con uso muy desigual entre clientes.

## Evolución futura: Weibull, supervivencia, forecasting

Con más historial y eventos confirmados (no solo inferidos), esta línea podría evolucionar a:
- **Análisis de supervivencia** (Kaplan-Meier) para modelar la probabilidad de que un repuesto siga "vivo" pasado cierto tiempo, incluyendo los casos censurados (repuestos que no se han cambiado todavía).
- **Distribución de Weibull** para modelar tasas de falla que cambian con el tiempo (desgaste progresivo vs. fallas tempranas).
- **Forecasting de demanda de repuestos** por cliente/máquina a partir de la tasa de reemplazo estimada, para planificación de inventario.

Ninguno de estos modelos está implementado en v1 - el v1 es deliberadamente simple (mediana + percentiles + score de confiabilidad) para ser transparente y auditable antes de introducir modelos estadísticos más sofisticados.
