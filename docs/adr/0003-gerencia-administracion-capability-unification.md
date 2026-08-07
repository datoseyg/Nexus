# ADR 0003 — Unificación funcional de `gerencia` y `administracion` vía capacidades

Fecha: 2026-07-31
Estado: Aceptada

## Contexto

El encargo pide que `gerencia` y `administracion` tengan exactamente las mismas capacidades en toda la app, sin fusionar ni renombrar los dos identificadores de rol (ambos deben seguir existiendo, por ejemplo para la etiqueta visual de sesión). Antes de este trabajo, `governance.role_capabilities` (sql/089) ya tenía un seed **asimétrico**: `administracion` tenía capacidades que `gerencia` no tenía, y 16 sitios en componentes cliente decidían qué mostrar comparando `role === "gerencia"` / `role === "administracion"` directamente.

## Decisión

- **Una migración de una línea, no un rediseño**: `sql/100_role_capabilities_unification.sql` espeja el set completo de capacidades de `administracion` sobre `gerencia` (`INSERT ... SELECT ... WHERE role='administracion' ON CONFLICT DO NOTHING`), idempotente. Ningún identificador de rol se elimina ni se renombra.
- **Nunca `role === "..."` fuera de un solo lugar cosmético.** Los 16 sitios que comparaban el string de rol se reemplazaron por `hasCapability(capabilities, "<capacidad real que ya exige la API detrás de esa acción>")` — una función pura y client-safe (`lib/auth/capabilities-shared.ts`) que no depende de sesión ni de red, solo compara contra el array de capacidades que la página ya resolvió una vez server-side (`fetchCapabilitiesForRole`). La única excepción documentada es `authorization-core.ts::roleLabel`, una etiqueta puramente visual que nunca gatea una acción.
- **Una prueba estática permanente** (`test/auth/auth-wiring.test.ts`) escanea `components/**/*.tsx` y `app/**/*.tsx` en busca del patrón `role === "gerencia"|"administracion"` y falla la suite si reaparece — convierte la regla en un invariante verificado en cada corrida, no en una convención de code review.
- La autoridad real de cada comando de gobierno sigue siendo el rol de conexión PostgreSQL + su `GRANT EXECUTE` (Gate B B34) — la unificación de capacidades es la primera capa (aplicación), no la única. `sql/100` no toca ningún `GRANT`; ambos roles de aplicación siguen usando las mismas conexiones dedicadas (`nexus_app_corrections`, `nexus_rule_evaluator`, etc.) que ya tenían.

## Alternativas consideradas

- **Fusionar `gerencia` y `administracion` en un solo rol.** Rechazada explícitamente por el encargo: "nunca fusionar, mantener ambos identificadores vivos" — probablemente porque la distinción sigue siendo significativa fuera del sistema de autorización (ej. reportes, quién solicitó qué).
- **Agregar `administracion` a cada chequeo `role === "gerencia"` existente (`role === "gerencia" || role === "administracion"`).** Rechazada: perpetúa la autorización por nombre de rol en vez de por capacidad — el próximo rol nuevo (si existiera) requeriría tocar los mismos 16 sitios otra vez. `hasCapability` desacopla "qué puede hacer este usuario" de "qué rol tiene".

## Consecuencias

- 14 pruebas de integración preexistentes que asumían "gerencia recibe 403" dejaron de ser válidas tras la unificación (consecuencia esperada y correcta, no una regresión) — se corrigieron con aserciones directas o fixtures dedicados donde compartir fixtures con `administracion` habría corrompido conteos existentes.
- Cualquier futura capacidad nueva (como `data:refresh:incremental`/`data:refresh:full`/`data:refresh:observe` de NEXUS V3) queda automáticamente disponible para ambos roles sin tocar componentes cliente, siempre que se agregue al seed de `governance.role_capabilities` para al menos uno de los dos y `sql/100` la propague.
