# Modelos predictivos de vida útil

Documento técnico del motor de modelos estadísticos de `/dashboard/equipment-lifecycle` (`src/models/lifecycle/*`, orquestado desde `src/gold/build-equipment-part-lifecycle-gold.js`). Complementa [EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md](EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md) (metodología general de la vista) y [BUSINESS_RULES_LAYER.md](BUSINESS_RULES_LAYER.md) (de dónde salen los umbrales).

> Ninguno de estos modelos reemplaza especificaciones del fabricante ni prueba causalidad. Son evidencia operacional observada, con su confiabilidad metodológica explícita.

## Por qué no usar Weibull puro con `n` pequeño

Un ajuste de máxima verosimilitud (MLE) de Weibull con 1-2 intervalos observados es inestable: el óptimo puede caer en cualquier punto de la superficie de verosimilitud (a menudo en un extremo absurdo, ej. `shape` muy alto ajustando "perfectamente" 2 puntos) y no hay forma de saber si es razonable sin un ancla externa. Por eso el motor:

1. Nunca ajusta Weibull con menos de `minimum_intervals_for_weibull` (default 3) intervalos.
2. Cuando sí lo ajusta, lo hace **bayesiano por grid** (no MLE puntual) - si hay pocos datos, el prior domina y el resultado se marca `PRIOR_DOMINATED`, nunca se presenta como si fuera tan confiable como un ajuste con historial real.
3. Si el óptimo del grid cae en el borde (`shape`/`scale` en el límite del rango explorado), se marca `UNSTABLE_POSTERIOR` y el selector **no lo usa** - cae a la mediana empírica en su lugar. Ver "No mostrar Weibull como mejor si no mejora sobre shrinkage" más abajo.

## El modelo AUTO (árbol de decisión)

Implementado en `src/models/lifecycle/lifecycle-model-selector.js`, con umbrales desde `business-rules/policies/lifecycle-model-policy.json`:

| Situación | Modelo | `prediction_status` |
|---|---|---|
| `n_intervals >= 3` | Mediana/media recortada, o Weibull bayesiano si es `STABLE` | `DIRECT_HISTORY_ENOUGH` |
| `n_intervals` en [1, 2], con cohorte disponible | Empirical-Bayes shrinkage | `LOW_N_SHRINKAGE` |
| `n_intervals` en [1, 2], sin cohorte, con ventana de exposición | Tasa Gamma-Poisson | `RATE_MODEL_ESTIMATE` |
| `n_intervals` en [1, 2], sin cohorte ni exposición extra | Mediana directa (baja confianza) | `LOW_N_SHRINKAGE` |
| 1 evento, sin intervalo, con cohorte | Shrinkage 100% cohorte (`machine_weight=0`) | `BORROWED_COHORT_ESTIMATE` |
| 1 evento, sin intervalo, sin cohorte | Sin estimación | `INSUFFICIENT_DATA` |
| 0 eventos usables | Sin estimación | `INSUFFICIENT_DATA` |

La extensión del "modelo Gamma-Poisson cuando hay pocos intervalos pero sí cobertura" no está en la redacción literal original de la regla 2 del usuario, pero es consistente con su regla 8 ("sirve cuando hay pocos intervalos pero sí conteos") - se documenta acá como una decisión de diseño explícita, no una improvisación silenciosa.

## Por qué mediana (modelo directo)

Igual que en la iteración anterior: la mediana es robusta a outliers de registro. Se muestra siempre junto a percentiles/desviación estándar, nunca sola.

## Empirical-Bayes shrinkage

`src/models/lifecycle/empirical-bayes-shrinkage.js`:

```
w = n_intervals / (n_intervals + k)
estimate = w * machine_estimate + (1 - w) * cohort_estimate
```

`k` (`shrinkage_k`, default 5) controla qué tan rápido se confía en el dato propio: con `n=1` y `k=5`, `w=0.17` (83% cohorte); con `n=4`, `w=0.44`. La cohorte usada sigue el orden `same_client_same_part -> same_part_global -> manufacturer_prior` (ver `cohort_priority` en la policy), resuelto de abajo hacia arriba porque el gold builder calcula `By_Part -> By_Client -> By_Machine` en ese orden y cada nivel usa el anterior ya calculado como cohorte.

**Limitación explícita**: `same_part_family` (agrupar por familia de repuesto) está en el `cohort_priority` de la policy pero **no implementado en v1** - requeriría agrupaciones reales de `business-rules/entities/part_families.csv`, que hoy solo tiene la fila de ejemplo. El selector salta directo de `same_part_global` a `manufacturer_prior` cuando no hay cohorte de cliente/parte disponible.

## Bayesian Weibull grid

`src/models/lifecycle/bayesian-weibull-grid.js`. Sin dependencias externas - todo en JS puro:

- **Grid**: `shape` en `[0.5, 5.0]` (60 pasos, lineal) × `scale` en `[30, 3650]` días (120 pasos, log-espaciado) - tamaños configurables en la policy.
- **Verosimilitud**: log-PDF Weibull evaluado en cada intervalo observado, sumado por punto del grid (log-likelihood, para estabilidad numérica).
- **Prior**: uniforme si no hay cohorte/fabricante; si hay un centro de cohorte, un prior log-normal débil sobre `scale` centrado ahí (`prior_strength: moderate` ⇒ sigma=1.0 en log-espacio).
- **Normalización**: log-sum-exp sobre el grid completo (evita overflow/underflow).
- **Percentiles (p10/p50/p90)**: no se integra la mixtura analíticamente - se evalúa la supervivencia mixta ponderada en un grid de tiempo (1 a 3650 días, log-espaciado) y se interpola dónde cruza 0.90/0.50/0.10. El intervalo creíble reportado (`credible_interval_low/high_days`) son literalmente `p10`/`p90`.
- **Media**: promedio ponderado de `scale * Gamma(1 + 1/shape)` por punto del grid (aproximación de Lanczos para la función Gamma, sin librería externa).
- **Estabilidad**: si el punto de máxima densidad posterior cae en el borde del grid (shape o scale en el extremo explorado), `posterior_quality_status = UNSTABLE_POSTERIOR` y el selector prefiere la mediana empírica. Si `n < minimum_intervals_for_weibull`, `PRIOR_DOMINATED`.

## Gamma-Poisson (tasa de reemplazo)

`src/models/lifecycle/gamma-poisson-rate-model.js` - cerrado analíticamente, sin integración numérica:

```
conteo_reemplazos ~ Poisson(lambda * años_exposición)
lambda ~ Gamma(alpha, beta)                    (prior, tasa/año)
lambda | datos ~ Gamma(alpha + conteo, beta + años_exposición)   (posterior)
```

Con `prior_alpha=1, prior_beta=1` (prior débil: media 1 reemplazo/año, peso equivalente a ~1 año de exposición previa). El intervalo creíble se aproxima con una normal sobre el posterior Gamma (no es la cuantila exacta - documentado como aproximación en el código). Útil cuando hay pocos intervalos pero sí una ventana de tiempo observada con conteo de eventos.

**Bug corregido durante la validación de esta iteración**: la primera versión de la policy traía `prior_beta: 365.0` pensando en "días", pero el modelo trabaja en años - eso aplastaba la tasa estimada a valores absurdos (vidas útiles de ~100 años). Corregido a `prior_beta: 1.0`. Ver `business-rules/policies/lifecycle-model-policy.json` para la nota explicativa de unidades.

## Intervalos creíbles

En Weibull y Gamma-Poisson, "intervalo creíble" es el equivalente bayesiano de un intervalo de confianza: el rango donde cae la vida útil/tasa con alta probabilidad **dado el modelo y los datos**, no una garantía frecuentista. Se reporta siempre junto al punto estimado (`estimated_life_p10/p50/p90_days`), nunca solo un número puntual - cumple el requisito de que Weibull "devuelva intervalos, no solo número puntual".

## n < 10: qué significa en la práctica

El modelo de confiabilidad (`src/models/lifecycle/lifecycle-prediction-confidence.js`) penaliza explícitamente `n_intervals < 10` (penalización moderada) y `n_intervals < 3` (penalización fuerte, adicional a la anterior). En los datos actuales, la gran mayoría de combinaciones máquina-repuesto tiene `n` de 0 a 2 - por diseño, esas combinaciones **no pueden mostrar confianza Alta** salvo un caso excepcional con cobertura larga, match exacto, asociación clara, cohorte disponible y modelo estable simultáneamente. Esto es intencional, no un defecto: es preferible mostrar "Insuficiente"/"Baja" honestamente que inflar la confianza de una estimación basada en 1-2 datos.

## Qué NO se puede inferir todavía

- `n_censored_observations` queda fijo en `0` - no se modela censura (un repuesto que sigue en servicio, nunca reemplazado, es información real para un modelo de supervivencia formal) por falta de señal confiable para distinguir "todavía no se rompió" de "ya no se usa este repuesto en esta máquina". Modelarlo requeriría saber si la máquina sigue operativa y con ese repuesto instalado - no disponible hoy.
- Los contratos (`client_contracts`, `worker_contracts`, `equipment_contracts`, `equipment_usage_profiles`) se cargan a DuckDB pero no alimentan el motor de modelos todavía - quedan como base para exposición operativa real en una iteración futura.
- `same_part_family` como cohorte no está implementado (ver arriba).
- Ningún modelo prueba causalidad - "la máquina tiene más actividad fuera de horario" es una correlación mencionada en insights, nunca una explicación demostrada.
- No reemplaza especificaciones de fabricante ni garantías contractuales - `comparison_to_manufacturer` es descriptivo, no normativo.

## Evolución futura

- Conectar `equipment_usage_profiles`/`client_contracts` como covariables de exposición real (horas de uso esperadas, no solo duración de la visita técnica).
- Implementar `same_part_family` una vez que `part_families.csv` tenga agrupaciones reales.
- Modelar censura explícita (Kaplan-Meier) para partes que nunca se han reemplazado pero la máquina sigue activa.
- Selector de modelo interactivo con recálculo en vivo (hoy filtra entre combinaciones ya calculadas por su `selected_model`, no recalcula una misma combinación bajo otro modelo en tiempo real - ver docs/APP_STRUCTURE_MAP.md).
