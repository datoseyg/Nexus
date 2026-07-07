# Modelo de Confiabilidad de Cálculo

## Qué es (y qué NO es)

El `confidence_score` (0-100) que acompaña cada KPI/fila de "Trabajo Fuera de Horario" es un **score de confiabilidad metodológica**, basado en la calidad de los datos, su trazabilidad y los supuestos usados en el cálculo.

**No es una probabilidad estadística.** No mide "qué tan probable es que el número sea correcto" en un sentido matemático - no hay un modelo entrenado, ni una distribución, ni un intervalo de confianza detrás. Es una heurística determinística: una suma de puntos por 6 factores conocidos, con umbrales fijos.

Un score de 100 no significa "garantizado correcto" - significa "todos los factores de calidad de datos conocidos están en su mejor estado posible dentro de este modelo". Un score de 40 no significa "40% de probabilidad de estar bien" - significa "hay supuestos fuertes o datos incompletos detrás de este número". **Ningún KPI de esta vista debe presentarse ni interpretarse como una certeza absoluta.**

## Los 6 factores y sus pesos (máximo 100)

| # | Factor | Completo | Parcial | Ninguno |
|---|---|---|---|---|
| 1 | `start_time` válido | **+25** | — | +0 |
| 2 | `duration_minutes` válido | **+25** (`5 ≤ min < 480`) | **+10** sospechoso/extremo (`<5`, `≥480`, o `=1440`) | +0 (ausente/cero/negativo) |
| 3 | Hora real de término | **+15** par reportado validado (plausible) | **+5** estimado (`start_time + duration_minutes`) | +0 (`start_time` inválido, no se puede estimar nada) |
| 4 | Calendario laboral configurado | **+15** validado con negocio | **+8** configurado pero sin validar (default) | +0 (no existe) |
| 5 | Feriados configurados | **+10** validado con negocio | **+3** solo fechas fijas, archivo `.example` incompleto | +0 (no existe) |
| 6 | Trazabilidad de fuente (cliente, tipo de tarea, técnico) | **+10** completa | **+5** falta un campo secundario | +0 (insuficiente) |

25+25+15+15+10+10 = 100.

## Etiquetas

| Rango | Etiqueta | Descripción |
|---|---|---|
| 0-39 | **Insuficiente** | El dato base no permite confiar en el cálculo. |
| 40-64 | **Baja** | El cálculo usa datos incompletos o supuestos fuertes. |
| 65-84 | **Media** | El cálculo es razonable, pero depende de supuestos o campos derivados. |
| 85-100 | **Alta** | El cálculo usa datos completos, consistentes y reglas validadas. |

## Ejemplo resuelto

Tarea con `start_time` válido, `duration_minutes = 90` (válido), sin par de horas reportado (se usa `start_time + duración`), calendario laboral configurado pero `DEFAULT_UNVALIDATED`, feriados solo con archivo `.example`, y cliente/tipo de tarea/técnico todos presentes:

```
25 (start_time) + 25 (duration) + 5 (término estimado) + 8 (calendario default) + 3 (feriados example) + 10 (trazabilidad completa) = 76 → Media
```

`confidence_factors` guardado como texto: `"start_time válido (+25) | duration_minutes válido (+25) | hora de término estimada (start_time + duration_minutes) (+5) | calendario laboral configurado pero sin validar con negocio (default) (+8) | feriados: solo fechas fijas, archivo example incompleto (+3) | trazabilidad completa (cliente, tipo de tarea, técnico) (+10)"`.

## Cómo se calcula a nivel de tarea

`src/lib/calculation-confidence.js` exporta `calculateTaskTimeConfidence(task, context)`, que aplica los 6 factores de arriba y devuelve `{ score, label, color, method, factors, factorDetails }`. `method` es uno de los 6 `calculation_method` (ver `docs/AFTER_HOURS_METRICS.md`); `calculationStatusFromMethod(method)` lo colapsa a 3 valores (`CALCULATED` / `CALCULATED_WITH_WARNINGS` / `NOT_CALCULABLE`) para filtrado simple. Se corre una vez por tarea en `src/marts/build-fieldbeat-working-hours-analysis.js` y se materializa como columnas del mart - la app **nunca** recalcula esto en vivo.

## Cómo se agrega a nivel de KPI/GOLD

`aggregateMetricConfidence(rows, metricType)` en el mismo archivo:

- **`metricType: "hours"`** (KPIs 1-4: horas totales, horas hábiles, horas fuera de horario, % fuera de horario) → **promedio ponderado por `duration_minutes`**. Una tarea de 10 horas con confianza baja pesa más que una de 5 minutos - refleja mejor el impacto real en la métrica de horas.
- **`metricType: "count"`** (KPI 5: tareas con trabajo fuera de horario) → **promedio simple**, sin ponderar. Un conteo trata cada tarea como una unidad discreta; ponderar por duración duplicaría una señal que ya se usa en los KPIs de horas.
- **KPI 6 (tareas no calculables)** no usa ninguna de las dos fórmulas de arriba: promediar la confianza de filas que fallaron el cálculo daría, al revés, un score bajo - confundiría "confianza en el conteo" con "confianza en el cálculo de las filas excluidas". Se usa un valor fijo alto (95), penalizado solo si `calculation_status` viniera vacío en alguna fila (lo que indicaría un bug en el pipeline, no un dato de negocio).

Esta misma fórmula existe en **3 lugares que deben mantenerse consistentes**: `src/lib/calculation-confidence.js` (Node, fuente de verdad, corre en el pipeline), la re-expresión SQL en `apps/nexus-bi-app/app/api/dashboard/after-hours/summary/route.ts` (`SUM(confidence_score * duration_minutes) / NULLIF(SUM(duration_minutes), 0)`), y el mirror liviano `apps/nexus-bi-app/lib/confidence.ts` (solo las etiquetas/colores, no recalcula scores).

## Cómo se muestra en la UI

- `components/ui/ConfidenceBadge.tsx`: `"Confiabilidad NN% · Etiqueta"` con color semántico (Alta=verde/success, Media=celeste/info, Baja=amarillo/warning, Insuficiente=rojo/danger) y tooltip con los factores.
- `components/ui/MetricCardWithConfidence.tsx`: si `score < 40` muestra "Usar con cautela"; si no, si `score < 65` muestra "Cálculo preliminar".
- La página `/dashboard/after-hours` lleva además un aviso permanente, independiente del score de cualquier KPI individual, aclarando que el score es metodológico y no una garantía de certeza.

## Advertencia final

Ningún indicador de esta vista debe presentarse, citarse o usarse como si tuviera 100% de certeza, incluso cuando su `confidence_score` sea 100. El score de 100 significa que el modelo de calidad de datos conocido no encontró ninguna debilidad - no que el número sea perfecto. Cualquier decisión operativa o contractual basada en estos KPIs debe pasar primero por la validación de negocio descrita en `docs/AFTER_HOURS_METRICS.md`.
