# 12 -Seguridad, privacidad y accesibilidad

## Datos personales identificados -comprobado, no asumido

Búsqueda dirigida sobre `sql/010_processed.sql` (schema `processed`, autogenerado por introspección del warehouse real) y `docs/DATA_DICTIONARY.md`, comando: `grep -rniE "paciente|patient|historia clinica|ficha clinica|email|telefono|phone|direccion|address" sql/*.sql docs/DATA_DICTIONARY.md`, commit `4a3d055`.

| Campo | Tabla | Tipo de dato personal | Evidencia |
|---|---|---|---|
| `assigned_to` | `processed.fieldbeat_tasks`, `marts.fieldbeat_working_hours_analysis` | Nombre real de técnico de terreno (persona física) | STATIC_CODE `sql/010_processed.sql:89`; confirmado LOCAL_RUNTIME -`GET /api/dashboard/after-hours/by-technician` devolvió 19 filas agrupadas por técnico |
| `client_name` / `fieldbeat_client_name` | `processed.fieldbeat_clients`, prácticamente todas las marts/gold | Nombre de institución/cliente (persona jurídica, no física) -confirmado LOCAL_RUNTIME un valor real: `"CLINICA ALEMANA DE SANTIAGO"` en `/api/dashboard/operacional/summary` | STATIC_CODE `sql/010_processed.sql:34,36` |
| `address_raw`, `city`, `commune`, `country` | `processed.fieldbeat_clients` | Dirección de la institución cliente (no de una persona física) | STATIC_CODE `sql/010_processed.sql:37-40` |
| `requester_id`, `submitter_id`, `assignee_id` | `processed.zendesk_tickets` | IDs numéricos de Zendesk, no nombres -el nombre de la persona, si aparece, estaría dentro de `subject`/`description` (texto libre) | STATIC_CODE `sql/010_processed.sql:135-159` |
| `subject`, `description`, `raw_subject` | `processed.zendesk_tickets` | **Texto libre sin estructurar** -puede contener nombres, teléfonos o correos escritos por el agente/técnico dentro del cuerpo del ticket; no hay forma de confirmarlo sin inspeccionar contenido real, lo cual esta auditoría no hizo (evitar exponer datos reales en un documento de auditoría) | STATIC_CODE -columnas de tipo TEXT sin ninguna sanitización visible en el pipeline (`src/normalizers/zendesk-normalizer.js` no aplica ninguna redacción) |

**Datos clínicos/PHI (historia clínica, datos de paciente):** **AUSENCIA CONFIRMADA**, no asumida. Búsqueda dirigida `grep -rniE "paciente|patient|historia clinica|ficha clinica" sql/*.sql docs/DATA_DICTIONARY.md` → 0 resultados en el schema completo (10 tablas `processed`, 8 `marts`, 21 `gold`) ni en el diccionario de datos. El negocio es servicio técnico B2B de equipamiento médico (instalación/mantención de LINAC, braquiterapia, CT, RX -`docs/DATA_DICTIONARY.md:161`, confirmado por tipo de equipo, no por datos de pacientes) -la relación es EyG↔institución cliente, no EyG↔paciente. Esta conclusión se basa en la ausencia de columnas y en la naturaleza B2B del dominio, **no** en una revisión de cada valor de texto libre (`subject`/`description`), que queda fuera del alcance de lectura de esta auditoría por la misma regla de no exponer datos potencialmente sensibles.

## Capacidades de lectura, escritura, exportación y eliminación

| Capacidad | Alcance | Evidencia |
|---|---|---|
| Lectura | 24 rutas públicas de solo lectura sobre `processed/marts/gold`, incluido `/explorer` que permite leer **cualquier columna de cualquiera de las 40 tablas**, sin restricción por columna (solo por schema/tabla vía `information_schema`) | `lib/sql-guardrails.ts:32-92`; confirmado LOCAL_RUNTIME |
| Exportación | CSV client-side (Explorer, solo página actual) y JSON client-side (resumen del Dashboard Operacional) -ambas ocurren en el navegador, no generan un archivo en el servidor | STATIC_CODE `lib/csv-export.ts:1-32`, `OperationalDashboardTab.tsx:251-260` |
| Escritura | Únicamente vía `/api/admin/**` (10 rutas), gateadas por token, sin caller en la UI hoy | Ver `04`§Administración |
| Eliminación | `DELETE` en 4 de los 5 recursos admin; `manual_review.part_aliases` usa **baja lógica** (`active=false`), `manual_review.ticket_link_overrides` usa **hard-delete**, `stock.stock_movements` solo permite `DELETE` si `status='PENDING'` (409 en caso contrario) | STATIC_CODE, ver `01`§C y `04`§Administración -ninguna de estas rutas se ejecutó realmente durante esta auditoría (regla de solo lectura) |

## Superficies sin autenticación

24 de 34 rutas API y 6 de 7 páginas de producto (todas salvo el gate implícito de `/api/admin/**`) -confirmado LOCAL_RUNTIME (200 sin credenciales en todas). Esto incluye `/explorer`, que expone lectura de las 40 tablas sin ninguna capa de permiso diferenciado por columna o por sensibilidad del dato (p. ej., un futuro campo con datos personales en `marts`/`gold` quedaría expuesto igual que cualquier otro).

## Operaciones protegidas por token

Las 10 rutas `/api/admin/**` -un único token compartido, sin roles diferenciados dentro de ese grupo (quien tiene el token puede leer y escribir los 5 recursos por igual, no hay separación p. ej. entre "solo lectura admin" y "escritura admin"). Confirmado LOCAL_RUNTIME: 401 sin token, 200 con token, en las 5 familias.

## Riesgo de exposición

| Riesgo | Severidad (evaluación cualitativa, no medida) | Razonamiento |
|---|---|---|
| `/explorer` sin restricción de columna | Medio-alto | Es la única superficie que podría exponer un campo sensible futuro sin que nadie lo decida explícitamente -cualquier columna nueva en `processed/marts/gold` queda automáticamente visible |
| Nombres de técnicos (`assigned_to`) visibles sin autenticación | Medio | Dato personal real, expuesto en al menos 2 pantallas públicas (`/dashboard/after-hours` por técnico, `/explorer`) sin ningún control de acceso |
| Texto libre de tickets Zendesk (`subject`/`description`) sin sanitizar | Medio (no confirmado, ver arriba) | Riesgo potencial de fuga de datos personales incidentales, no verificado por esta auditoría a propósito |
| Token admin único sin rotación ni expiración visible | Medio | `lib/auth.ts` compara un string estático; no hay evidencia de rotación, expiración ni límite de intentos |

## Necesidades de auditoría

`audit.data_quality_events` ya existe y tiene datos reales (confirmado LOCAL_RUNTIME, ≥1 fila) -pero registra eventos de calidad de dato del pipeline, no accesos de usuario. **No existe ningún log de acceso/auditoría de quién leyó o exportó qué** (ni para las rutas públicas ni para las admin) -AUSENCIA CONFIRMADA, mismo método de búsqueda que en `02`§3 (sin analytics, sin logs de acceso en el código).

## Requisitos de enmascaramiento

Ninguno implementado hoy -todas las columnas se sirven tal cual están en Postgres. TO_BE/PROPUESTA: si D5 (`11-product-decision-register.md`) resulta en un sistema de roles real, definir qué columnas (empezando por `assigned_to` y el texto libre de tickets) requieren enmascaramiento por rol.

## Accesibilidad actual

No verificable en runtime con las herramientas de esta sesión (no se ejecutó ningún auditor de accesibilidad tipo axe/Lighthouse) -`NOT_RUNTIME_VERIFIED`. Revisión estática rápida: no se encontró uso sistemático de atributos `aria-*` ni `role=` en los componentes leídos durante la exploración previa (`components/ui/*.tsx`) -esto es una impresión de lectura, no un barrido exhaustivo componente por componente, y se declara así explícitamente en vez de afirmarse como auditoría completa.

## Objetivo mínimo WCAG propuesto (TO_BE) para el nuevo frontend

PROPUESTA, no una decisión tomada: WCAG 2.1 nivel AA como piso mínimo razonable para un producto operacional interno con paletas de estado semántico (los tokens `--eyg-warning/--eyg-danger/--eyg-info` de `07-brand-system.md` deberían verificarse contra contraste AA antes de reutilizarse tal cual). Esta es una recomendación de esta auditoría, sujeta a validación del dueño de producto -no se etiqueta CONFIRMADA porque no hay decisión de producto que la respalde todavía.

## Fuentes

`sql/010_processed.sql`, `docs/DATA_DICTIONARY.md`, `apps/nexus-bi-app/lib/{sql-guardrails,csv-export,auth}.ts`, `04-data-and-api-contracts.md`, `02-users-roles-and-tasks.md`§3, sondeo LOCAL_RUNTIME de esta sesión, búsquedas de ausencia citadas inline con su comando exacto.
