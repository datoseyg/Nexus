# 09 — Principios de diseño

Cada principio se ancla en evidencia real del repositorio auditado — precedente existente (el producto ya lo hace en alguna parte) o contraejemplo confirmado (el producto lo viola en alguna parte, lo que motiva el principio como PROPUESTA a reforzar). Ningún principio se presenta como ya universalmente aplicado si la evidencia no lo respalda en las 7 pantallas.

## 1. Trazabilidad antes que decoración

**Precedente (AS_IS):** el panel de "SQL ejecutada" en `/search` (`QueryDisclosure`, STATIC_CODE `app/api/search/route.ts:92-104`) expone la consulta real al usuario. El `suggested_action` textual en `/audit/manual-review` cita la razón de la clasificación (`lib/audit-sql.ts:suggestAction`), no solo el resultado.
**Aplicación:** cualquier número nuevo que Claude Design muestre debe poder trazarse a su tabla/endpoint de origen (ver `04`), igual que ya ocurre en estas dos pantallas.

## 2. Excepción antes que volumen

**Precedente (AS_IS):** el badge de "pendientes de revisión" en `NavBar.tsx:60-70` prioriza el conteo de excepciones (`reportsReviewRequired`) sobre el volumen total — es lo primero visible al navegar, no un dato enterrado en una tabla.
**Contraejemplo a corregir (PROPUESTA):** `/dashboard/operacional` muestra `totalRegistros:3747` con el mismo peso visual que `pctConTicketAccesible:7.74%` — el número pequeño (la excepción real: solo 7.74% es trazable) no está jerárquicamente destacado sobre el número grande. Aplicación: la excepción (bajo % de cobertura) debe pesar visualmente más que el volumen bruto.

## 3. Acción antes que observación — con salvedad de esta branch

**Contraejemplo confirmado (AS_IS):** las 5 secciones de `/audit/manual-review` listan excepciones sin ninguna acción ejecutable (`FutureActionButton.tsx`, deshabilitado por diseño). Esto no es una violación involuntaria — es una decisión del propio producto, documentada en el tooltip.
**Aplicación como PROPUESTA:** el principio se activa **solo si D6 (`11-product-decision-register.md`) se resuelve** — mientras la escritura de Auditoría siga `blocked by product decision`, Claude Design no debe simular acciones ejecutables (evita la "acción antes que observación" precisamente para no inventar un flujo de escritura no aprobado, ver `08`§`/audit/manual-review`).

## 4. Contexto antes que KPI aislado

**Contraejemplo confirmado (AS_IS):** ninguna cifra de `05-business-metrics.md` enlaza en pantalla a `docs/SCOPE_AND_LIMITATIONS.md` — un KPI de `/dashboard/fieldbeat` (universo 3.747) y uno de `/dashboard/operacional` (universo 628) pueden leerse como comparables sin serlo.
**Aplicación:** todo KPI de universo parcial debe llevar su alcance adjunto (ej. "7.74% de cobertura Zendesk" junto al número, no en un documento aparte) — precedente ya parcial en el propio código: `downtimeWarning:true` y el copy "methodological, not statistical" de After-Hours sí llevan su contexto pegado al número.

## 5. Estado del dato siempre visible

**Precedente fuerte (AS_IS):** After-Hours expone `confidence_score`/`confidence_label` junto a cada KPI (`types/after-hours.ts:6-11`); Uptime/Downtime expone `downtimeWarning:true` en la misma respuesta que los datos; `ChartCard.tsx` usa `available`/`unavailableReason` en vez de mostrar un gráfico vacío sin explicación.
**Aplicación:** este es, de los 8 principios, el que el producto ya cumple más consistentemente — extenderlo a `/dashboard/operacional`, que hoy no expone el estado "parcial" (7.74%) con el mismo tratamiento visual que After-Hours da a su confianza.

## 6. Densidad controlada

**Contraejemplo confirmado (AS_IS):** `components/dashboard/OperationalDashboardTab.tsx` es el componente más grande de la app (STATIC_CODE, ~630 líneas) — filtros, 3+ gráficos Chart.js, 2 tablas y export, todo en una sola pantalla sin jerarquía de secciones colapsables salvo el `FilterPanel` genérico (no confirmado que se use aquí, ver `07`§ nota sobre `FilterPanel.tsx` no importado por las pantallas revisadas).
**Aplicación:** PROPUESTA — introducir densidad progresiva (resumen primero, detalle expandible) en la pantalla con más superficie de datos por vista.

## 7. Semántica cromática consistente

**Precedente fuerte (AS_IS):** la regla ya documentada (aunque en un doc LEGACY, `07-brand-system.md`§4) — "amarillo/rojo reservados a advertencia/error, nunca color neutro de gráfico" — y aplicada en código vigente: `ConfidenceDistributionChart.tsx` usa color por tier semánticamente (Insuficiente=rojo, Alta=verde), y los tokens `--eyg-warning`/`--eyg-danger` en `globals.css` solo se usan para esos fines (STATIC_CODE, confirmado por lectura del archivo completo).
**Aplicación:** mantener esta regla ya vigente; no reintroducir paletas categóricas donde rojo/amarillo aparezcan como "serie 4 de un gráfico" sin significado de estado.

## 8. Ninguna métrica sin definición ni procedencia

**Contraejemplo confirmado y cuantificado (AS_IS):** `docs/GOLD_DATA_CONTRACT.md` no tiene ninguna mención de frescura/SLA/responsable (grep confirmado, 0 resultados — ver `05-business-metrics.md`). Ninguna de las 6 tablas GOLD principales expone `updated_at` en su respuesta API.
**Aplicación:** este principio se propone precisamente **porque** el estado actual lo viola — es DESCONOCIDA la fecha de actualización y el responsable de cada métrica GOLD hoy. Cualquier métrica nueva que Claude Design proponga debe fijar ambos campos desde el diseño, no heredarlos como ausentes.

## Nota de aplicación general

Los principios 1, 5 y 7 tienen precedente fuerte y consistente en el código ya escrito — son extensión, no invención. Los principios 2, 4, 6 y 8 se proponen explícitamente **a partir de una brecha confirmada**, no de una aspiración sin base. El principio 3 depende de una decisión de producto todavía abierta (D6) y no debe aplicarse a `/audit/manual-review` hasta que esa entrada cambie de estado.

## Fuentes

`components/ui/*.tsx`, `app/api/search/route.ts`, `lib/audit-sql.ts`, `NavBar.tsx`, `types/after-hours.ts`, `components/dashboard/{ChartCard,OperationalDashboardTab,ConfidenceDistributionChart}.tsx`, `app/globals.css`, `docs/GOLD_DATA_CONTRACT.md`, `05-business-metrics.md`, `11-product-decision-register.md`.
