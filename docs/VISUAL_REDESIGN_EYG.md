# Rediseño visual - identidad E&G Medical Systems

Sprint de rediseño de `apps/nexus-bi-app` para que la app deje de verse como un dashboard genérico azul y refleje la identidad de **E&G Medical Systems** (empresa médica/tecnológica: instalación, soporte y equipamiento médico de alta tecnología). Referencia institucional: [eygsa.cl](https://www.eygsa.cl/index.html) - estética limpia, profesional, verde/gris, sensación de sistema de soporte técnico confiable.

## Paleta

Definida en `app/globals.css` (`:root`, con variante `prefers-color-scheme: dark`) y espejada en `components/dashboard/dashboard.module.css` (`.root`, mismo valores bajo nombres `--db-*` para no acoplar el CSS Module del dashboard a las variables globales):

```
--eyg-green:      #6bbe45   verde E&G (acento, hover, éxito)
--eyg-green-dark: #3c8c2e   verde principal - botones primarios, tabs activos, líneas de gráfico
--eyg-lime:       #a7d943   acento cálido, variedad categórica en charts
--eyg-teal:       #1f8a8a   secundario - degradado del logo, barras mini, KPIs secundarios
--eyg-ink:        #243033   texto principal
--eyg-muted:      #5e6b70   texto secundario/muted
--eyg-bg:         #f4f7f6   fondo general (gris verdoso muy claro)
--eyg-card:       #ffffff   fondo de cards
--eyg-border:     #dde6e3   bordes suaves
--eyg-warning:    #f4b740   solo advertencias
--eyg-danger:     #d9534f   solo errores/estados críticos
--eyg-info:       #2d9cdb   acento informativo puntual (nunca color principal)
```

**Regla aplicada en todo el rediseño:** verde E&G es el color principal (nunca azul genérico); teal es el único secundario; amarillo/rojo quedan reservados semánticamente para advertencia/error (nunca para "serie 4 del gráfico" o un botón de acción neutro). La paleta categórica de Chart.js (`DASHBOARD_PALETTE_SEQUENCE` en `lib/dashboard-formatters.ts`) también fue reordenada: verde → teal → lima → info → púrpura → naranja → gris → cyan → amarillo → rojo (los dos últimos, casi nunca usados en gráficos categóricos, solo como resto de la secuencia).

## Tokens de diseño

`app/globals.css` remapea los tokens genéricos que ya consumía el resto de la app (`--surface-1`, `--page-plane`, `--text-primary`, `--text-secondary`, `--border`, `--status-good/warning/serious/critical`, etc.) a la paleta E&G - así todos los componentes existentes (`KpiCard` → `MetricCard`, `ErrorBanner`, `DataTable`, `PaginationControls`, `NavBar`) heredan el nuevo look **sin reescribir su lógica**, solo cambiando de dónde toman su color. Esto evita duplicar un segundo sistema de estilos en paralelo.

## Componentes creados (`components/ui/`)

| Componente | Reemplaza / rol |
|---|---|
| `AppShell.tsx` | Envoltorio NavBar + contenedor centrado; cada página elige `wide` (grillas de varias columnas: Dashboard Operacional, Auditoría) o angosto (Explorer, Search, landing). El layout raíz (`app/layout.tsx`) quedó deliberadamente mínimo para permitir esta variación por ruta. |
| `PageHeader.tsx` | Reemplaza los bloques `<h1>/<p>` ad-hoc de cada pantalla. |
| `SectionCard.tsx` | Card blanca genérica con título/descripción/acciones opcionales. |
| `MetricCard.tsx` | Reemplaza `components/KpiCard.tsx` (eliminado - un solo caller, migrado directo). Agrega `tone` (success/warning/danger) para KPIs con semántica de estado. |
| `FilterPanel.tsx` | Panel de filtros colapsable en móvil, para pantallas fuera del dashboard (Auditoría, futuro Explorer). |
| `StatusBadge.tsx` | Pill de estado + helpers `matchStatusBadge`/`reportQualityBadge`/`zendeskJoinBadge` que traducen los vocabularios reales del pipeline (`match_status`, `report_quality_status`, `zendesk_join_status`) a `{label, tone}` - usados en Auditoría. |
| `EmptyState.tsx` | Mensaje vacío estándar. |
| `ResponsiveTableShell.tsx` | Chrome de tabla compartido (ver sección dedicada abajo). |

El Dashboard Operacional (`components/dashboard/*`, CSS Module propio) no se duplicó en `components/ui/` - se reskineó in-place (mismos componentes, tokens de color remapeados) porque su diseño es específico del layout de referencia "Proyecto 7" y ya no mapea a utilidades genéricas.

## ResponsiveTableShell

Chrome único para toda tabla de la app: título + conteo + acciones (incluye toggle de densidad cómoda/compacta opcional) en el header, contenedor con `overflow: auto` + `max-height` configurable, header de tabla `sticky` vía selectores `:global()` (funciona con cualquier `<table>` que reciba como `children` - TanStack Table de Explorer o markup plano del dashboard, sin que le importe la implementación), truncado de celdas largas con elipsis, y estados de carga/error/vacío explícitos.

Aplicado a:
- Tabla Uso de Repuestos y Detalle Operativo (vía `DataTableCard.tsx`, refactorizado para delegarle el chrome).
- Explorador de Tablas (`app/explorer/page.tsx`).
- Resultados de Búsqueda (`app/search/page.tsx`).
- Las 5 tablas de Auditoría / Validación Manual.

## Layout del Dashboard Operacional - qué corrige

**Problema anterior:** "Estado General" (gráfico) compartía una fila `grid21` (1fr : 1.6fr) con la tabla de Uso de Repuestos - ambos quedaban apretados, y en pantallas medianas el gráfico se comprimía hasta ser ilegible. Las tablas grandes (Uso de Repuestos, Detalle Operativo) nunca tenían el ancho completo disponible.

**Corrección aplicada** (`components/dashboard/OperationalDashboardTab.tsx` reestructurado en filas independientes):

1. `FilterPanel` sticky (top de la pestaña), colapsable en pantallas < 900px (botón "Ocultar/Mostrar filtros").
2. Fila de KPI cards (`grid-template-columns: repeat(auto-fit, minmax(180px,1fr))` - se auto-ajusta al ancho disponible en vez de una cuenta de columnas fija).
3. Fila 1 (`grid2`): Distribución de Estados + Evolución Operativa.
4. Fila 2 (`grid4`, colapsa a 2 columnas en laptop y a 1 en tablet/móvil): Uso Bodegas (Clientes), Ranking Bodegas, % Tickets por Cliente, **Estado General** (movido acá - ya no comparte fila con una tabla).
5. Fila 3 (ancho completo): Atenciones Máquinas x Clientes.
6. Fila 4 (ancho completo): Tabla Uso de Repuestos.
7. Fila 5 (ancho completo): Detalle Operativo.

## Criterios responsive

- **Desktop ancho (> 1400px):** `AppShell wide` da hasta 1400px de ancho útil; grids de 3-4 columnas a ancho completo.
- **Laptop mediano (1100–1400px):** `grid3`/`grid4` colapsan a 2 columnas (`@media max-width: 1400px`).
- **Tablet (≤ 1100px):** todos los grids del dashboard colapsan a 1 columna; el `FilterPanel` se vuelve colapsable.
- **Móvil (≤ 640px):** KPI row pasa a 2 columnas; charts bajan a una altura fija de 220px (en vez de `clamp()` con `vw`, que en pantallas muy angostas podía quedar demasiado bajo).
- **Cualquier ancho:** ninguna tabla rompe el viewport - `ResponsiveTableShell`/`DataTableCard` siempre tienen `overflow-x: auto` propio; las celdas truncan con `text-overflow: ellipsis` + `title=` (tooltip) para el texto completo; los charts nunca tienen `width` fijo en píxeles, solo `height`.
- **Top N + Otros:** los gráficos de máquinas/clientes (Atenciones Máquinas x Clientes) ya limitaban a top 8 clientes × top 10 máquinas antes de este sprint - se mantuvo, es la estrategia correcta para no saturar el gráfico con leyendas largas.

## Antes / después (conceptual)

| Antes | Después |
|---|---|
| Header y tabs azules, logo con degradado azul→teal | Header/tabs verdes E&G, logo con degradado verde→teal |
| Botón "Descargar Informe" amarillo (acción confundible con advertencia) | Verde primario - el amarillo queda solo para advertencias reales |
| Tabla de repuestos header `#eaf1ff`/`#274b8c` (azul) hardcodeado | Header de tabla verde claro (`--db-header-bg`/`--db-header-text`), token reutilizable |
| "Estado General" apretado junto a una tabla de datos | Fila propia de 4 charts de distribución, tablas en filas dedicadas de ancho completo |
| Selector de período reemplazado por un select fijo (sprint anterior) sin filtros de identidad avanzados | Filtros de identidad + fecha en un panel sticky/colapsable, sin cambios de layout entre desktop y mobile más que el colapso |
| `components/KpiCard.tsx` desconectado del resto del sistema de tokens | `MetricCard.tsx` en `components/ui/`, mismo sistema de tokens que toda la app |

## Qué NO cambió

- Ninguna corrección de semántica de datos del dashboard (estados de ticket, KPIs, cross-filter) - ese trabajo es de un sprint anterior y se dejó intacto, ver [DASHBOARD_VISUAL_STYLE.md](DASHBOARD_VISUAL_STYLE.md).
- No se tocó `.env`, RAW, PROCESSED, MARTS, GOLD ni DuckDB - este sprint es 100% frontend (CSS, componentes, layout).
- No se implementó autenticación, deploy, ni Ollama.
