# 03 -Arquitectura de información

## Mapa de navegación actual (AS_IS · CONFIRMADA, transcripción literal)

Fuente única: `apps/nexus-bi-app/components/NavBar.tsx:7-14` (confirmado LOCAL_RUNTIME -las 7 URLs devolvieron 200).

```
/  (landing -enlaces a las 6 pantallas siguientes, apps/nexus-bi-app/app/page.tsx)
├─ /dashboard/fieldbeat        "Dashboard FieldBeat"
├─ /dashboard/operacional      "Dashboard Operacional"   (2 tabs internas: Operacional, Uptime/Downtime)
├─ /explorer                   "Explorador"
├─ /search                     "Búsqueda"
├─ /audit/manual-review        "Auditoría"                (6 tabs internas, badge de pendientes)
└─ /dashboard/after-hours      "Trabajo Fuera de Horario"
```

No hay jerarquía de más de 2 niveles (ruta → tab interna) en ningún punto del árbol. No hay breadcrumbs, no hay sidebar -es una barra superior horizontal única (`NavBar.tsx:44-74`). El texto "Fase 1 MVP - solo lectura" aparece fijo en la esquina de la barra (`NavBar.tsx:76-78`) -el propio producto se autodeclara de solo lectura.

## Mapa recomendado (solo capacidades AS_IS de `01-functional-inventory.md`)

El mapa recomendado es **idéntico al actual** en su nivel superior -las 7 rutas ya existentes son, en este commit, la totalidad de la superficie de producto con capacidad AS_IS confirmada. La única diferencia recomendada es de **énfasis**, no de estructura, y se basa en la clasificación de prioridad de `08-screen-evidence-matrix.md`:

```
/  (landing)
├─ /dashboard/fieldbeat        -design ready
├─ /dashboard/operacional      -design ready (ambas tabs)
├─ /dashboard/after-hours      -design ready
├─ /audit/manual-review        -designable con salvedad: solo la parte de LECTURA (listados/filtros/resumen).
│                                 La parte de ACCIONES (5 secciones × botón deshabilitado) queda excluida
│                                 deliberadamente del mapa recomendado -ver 11-product-decision-register.md
├─ /explorer                   -excluido del mapa de producto recomendado: lee como herramienta interna
│                                 de depuración (browser genérico de schema/tabla), no como tarea de negocio
└─ /search                     -mismo criterio que /explorer (SQL/ILIKE con panel de "SQL ejecutada" visible)
```

**Excluido deliberadamente** (no porque no exista evidencia, sino porque la evidencia apunta a herramienta interna, no a superficie de producto para las personas de negocio de `02-users-roles-and-tasks.md`): `/explorer`, `/search`. Ver clasificación completa por pantalla en `08`.

## Relaciones entre módulos

```
Zendesk (demanda/ticket) ──┐
                            ├──▶ MARTS (joins resueltos) ──▶ GOLD (agregado, con calidad de dato) ──▶ Dashboards
FieldBeat (ejecución) ─────┤
                            │
Dolibarr (catálogo/repuesto)┘
```

- El flujo de negocio real descrito por el propio proyecto: "un ticket Zendesk genera un trabajo → se ejecuta y reporta en FieldBeat → el reporte menciona repuestos usados → esos repuestos deben identificarse contra el catálogo Dolibarr" (STATIC_DOC `docs/ARCHITECTURE.md:39`).
- Los módulos de pipeline (ingesta, normalización, resolución de identidad, marts, QA, GOLD, migración) **no tienen relación 1:1 con una pantalla** -son insumo para todas las pantallas de producto simultáneamente. Ningún módulo de pipeline tiene su propia UI de operación (confirmado: `audit.pipeline_runs` existe como tabla y CRUD pero está vacía en runtime y no la escribe ningún script -ver `01`§A/§C).
- `manual_review.*` y `stock.*` están conceptualmente "después" del flujo GOLD (correcciones y efectos posteriores), pero hoy son ramas muertas sin conexión de UI -no aparecen en el mapa de navegación en absoluto.

## Jerarquía de objetos del dominio

```
Ticket Zendesk (processed.zendesk_tickets)
   │  vínculo puente (BR_Ticket_FieldBeat_Task)
   ▼
Task/Reporte FieldBeat (processed.fieldbeat_tasks)
   │  1 : N
   ▼
Repuesto usado (processed.fieldbeat_used_parts)
   │  resolución de identidad (match_status)
   ▼
Producto Dolibarr (processed.dolibarr_products)
   │  (propuesto, no implementado)
   ▼
Movimiento de stock (stock.stock_movements) -TO_BE, tabla existe, sin escritor automático
```

Objetos secundarios sin jerarquía de negocio clara todavía (huecos, ver `11-product-decision-register.md`): `Equipo`/`Máquina` (`processed.fieldbeat_equipments`, usado como dimensión de filtro en casi todas las pantallas pero sin pantalla propia de "ficha de equipo" -el dashboard Equipment Lifecycle que cubriría esto es LEGACY/otra branch, ver `01`§D).

## Fuentes

`apps/nexus-bi-app/components/NavBar.tsx`, `app/page.tsx`, `docs/ARCHITECTURE.md:31-41`, `01-functional-inventory.md`, `08-screen-evidence-matrix.md` (clasificación de prioridad), sondeo LOCAL_RUNTIME de esta sesión.
