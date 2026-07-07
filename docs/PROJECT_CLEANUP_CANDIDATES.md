# Candidatos de limpieza (solo clasificación - no se borra nada irreversible)

Este documento **no borra ningún archivo**. Cada fila tiene una acción recomendada, y la columna "¿Borrar ahora?" es siempre **NO**. Sí se ejecutaron, en la pasada de estabilización del 2026-07-04, un puñado de acciones explícitamente autorizadas y reversibles (mover documentos históricos sin referencias a `docs/legacy/` vía `git mv`, corregir un bug de un script deprecado, agregar un patrón a `.gitignore`) - todas documentadas abajo, ninguna es una eliminación.

**Historial de esta auditoría:**
- **2026-07-04 (auditoría inicial):** registro completo, sin ninguna acción correctiva.
- **2026-07-04 (pasada de estabilización):** revisión de los 4 `possible_secret_hits` (todos falsos positivos, ver sección 7), corrección de `src/miners/fieldbeat.js` (deprecado explícitamente en vez de roto en silencio), `*.tsbuildinfo` agregado a `.gitignore`, y 9 archivos legacy sin referencias movidos a `docs/legacy/` (ver sección 4).

---

## 1. Archivos posiblemente huérfanos

| Archivo | Motivo | Evidencia | Acción recomendada | ¿Borrar ahora? |
|---|---|---|---|---|
| `./nodenpm` (raíz) | Archivo de 0 bytes, nombre sin sentido (`node`+`npm` pegados) | `ls -la` → 0 bytes; `file` → empty; no aparece en ningún import, script, ni doc | **Re-revisado 2026-07-04:** sigue sin ningún propósito detectable. No se borró (fuera del alcance autorizado - "no borrar todavía"). Candidato firme a eliminación en cuanto se confirme con el equipo que no tiene valor | NO |
| `src/request.http` | Contiene código JS (no HTTP requests, pese al nombre/extensión), casi idéntico a `src/run-all.js` pero usando el miner FieldBeat viejo (`fieldbeat.js` en vez de `fieldbeat-all.js`) | `diff src/request.http src/run-all.js` → solo difieren en qué miner de FieldBeat importan; grep de `"request.http"` en todo el repo → 0 referencias | **Re-revisado 2026-07-04:** con `src/miners/fieldbeat.js` ahora deprecado explícitamente (ver sección 3), este archivo referencia un miner que ya nadie debería usar - refuerza que es puramente histórico. No se borró (es código, no documento - "no mover código sin confirmar"). Candidato firme a eliminación | NO |
| `apps/nexus-bi-app/components/ui/EmptyState.tsx` | Componente de UI genérico sin ningún importador | grep de `components/ui/EmptyState` en todo `apps/nexus-bi-app` → único match es su propia definición (confirmado de nuevo por `npm run audit:structure`) | Confirmar si está pensado para uso futuro (ej. Centro de Correcciones) o si `ResponsiveTableShell`'s estado vacío inline ya lo volvió redundante. No se movió ni se borró (es código) | NO |
| `apps/nexus-bi-app/components/ui/FilterPanel.tsx` | Componente de filtro genérico sin ningún importador | grep de `components/ui/FilterPanel` → único match es su propia definición (confirmado de nuevo por `npm run audit:structure`) | Parece una iteración de diseño anterior a los filter bars específicos por vista. No se movió ni se borró (es código) | NO |

## 2. Archivos duplicados conceptualmente

| Archivo(s) | Motivo | Evidencia | Acción recomendada | ¿Borrar ahora? |
|---|---|---|---|---|
| `data/config/part_identity_aliases.example.csv` vs. `data/curation/part_identity_aliases.example.csv` | Mismo concepto (alias de identidad de repuestos), **schemas distintos** - **duplicado deliberado, no accidental** | `diff` muestra que la versión de `data/config/` tiene 5 columnas (`alias_value,alias_type,dolibarr_product_id,dolibarr_ref,reason`) y la de `data/curation/` tiene 7 (agrega `created_by,created_at`, con trazabilidad de auditoría). La de `data/config/` la lee de verdad `src/marts/build-used-parts-dolibarr-match.js` (pipeline activo, hoy); la de `data/curation/` la valida `src/curation/validate-curation-files.js` contra el schema del futuro Centro de Correcciones (`docs/CURATION_MODEL.md`), pero nada la conecta al pipeline todavía | Ninguna acción - son dos plantillas de dos sistemas distintos (config activa vs. modelo de curación futuro) que coinciden en tema. Documentar esta distinción de forma más visible (ej. un comentario en cada `.example.csv`) para que un futuro desarrollador no las confunda | NO |
| `src/normalizers/fieldbeat-normalizer.js` reimplementa `csvEscape`/`writeCsv`/`ensureDir` en vez de importar `src/lib/csv.js` | Duplicación de código funcional (no de archivo) - `zendesk-normalizer.js` y `dolibarr-normalizer.js` sí importan el helper compartido | Lectura directa de los 3 normalizers | Unificar en una limpieza futura para que los 3 normalizers usen el mismo helper - hoy funciona igual, es solo inconsistencia | NO |
| `src/miners/fieldbeat.js` (miner puntual) vs. `src/miners/fieldbeat-all.js` (miner paginado) | Ambos "minan FieldBeat" pero con propósito distinto (uno por ID puntual, otro paginación completa) - duplicado conceptual esperado/documentado, no accidental (ver `CLAUDE.md`) | Los dos archivos tienen scripts propios (`get:fieldbeat`, `get:fieldbeat:all`) y roles distintos documentados | Ninguna - es la separación correcta. Solo arreglar el bug de `fieldbeat.js` (ver sección 3) | NO |

## 3. Archivos con posibles errores funcionales

| Archivo | Motivo | Evidencia | Estado | ¿Borrar ahora? |
|---|---|---|---|---|
| `src/miners/fieldbeat.js` (script `get:fieldbeat`) | Usaba una variable `taskId` que nunca se declaraba en su scope (solo existía `taskIds`, el array plural) y nunca iteraba sobre `taskIds` para construir una URL por tarea - el `fetch` se hacía una sola vez contra `FIELDBEAT_API_BASE_URL` sin usar los IDs en absoluto | Lectura directa del archivo original (líneas ~34-48): declaraba `const taskIds = [...]` pero después solo usaba `taskId` (singular, indefinido) dentro de un bloque `try` sin loop | **RESUELTO (2026-07-04):** se optó por **deprecar explícitamente** en vez de "adivinar" el endpoint real de FieldBeat para traer un task por ID (nunca documentado en `CLAUDE.md` ni usado en ningún otro lugar del repo - implementarlo mal habría sido peor: un miner que "funciona" pero trae datos incorrectos en silencio). Ahora `mineFieldBeatTasks()` valida las env vars igual que antes, pero termina lanzando un error explícito y claro ("está DEPRECADO y deshabilitado... usar get:fieldbeat:all") en vez de un `ReferenceError` confuso. **No se tocó `get:fieldbeat:all`.** | NO (no aplica - no era un archivo a borrar, era un bug a corregir) |

## 4. Archivos legacy / material de referencia histórico

| Archivo | Motivo | Acción | ¿Borrar ahora? |
|---|---|---|---|
| `docs/P4.gs.txt`, `docs/P5.txt` | Código fuente crudo de Google Apps Script de los sistemas predecesores "Proyecto 4" (sync stock FieldBeat↔Dolibarr) y "Proyecto 5" (variante Apoteca-FALP) | **NO movidos** (a diferencia de la fila de abajo) - `docs/CURATION_MODEL.md` y `docs/PHASE_2_HANDOFF.md` los mencionan conceptualmente por nombre de proyecto; mover el código sin confirmar contradice la instrucción explícita de esta pasada ("no mover código sin confirmar"). Quedan en `docs/` (raíz) | NO |
| `docs/Documentación Proyecto 4.md` | Spec completa (v19.01.2026) del sistema Apps Script predecesor - referenciada desde `CURATION_MODEL.md` y `PHASE_2_HANDOFF.md` | **NO movida** - es un documento (no código), pero moverla rompería las 2 referencias cruzadas existentes sin actualizarlas primero; se prefirió no arriesgar enlaces rotos en esta pasada. Candidata a mover a `docs/legacy/` en una futura pasada que también actualice esas 2 referencias | NO |
| `docs/legacy/Proyecto%204%20-%20Sincronizaci%C3%B3n%20Fieldbeat-Dolibarr.json` | Nombre de archivo **URL-encoded literal** (`%20`, `%C3%B3` sin decodificar). Contiene un export completo de proyecto Apps Script (básicamente el mismo "Código" que `P4.gs.txt` más varios scripts auxiliares) | **MOVIDO (2026-07-04)** de `docs/` a `docs/legacy/` vía `git mv` (0 referencias cruzadas confirmadas antes de mover) - el nombre de archivo en sí sigue sin decodificar; renombrarlo queda pendiente para una futura pasada | NO |
| `docs/legacy/desglose_tecnologico_eyg.html`, `docs/legacy/relevamiento_maestro_nexus_cerberus.html`, `docs/legacy/levantamiento_maestro.pdf`, `docs/legacy/Proyecto 6_ Log Tickets Zendesk-Fieldbeat (1).xlsx`, las 3 CSV "Proyecto 7 Unificacion P4-P5...", `docs/legacy/Proyecto_7__Dashboard_Operacional_EyG_-_Integración_FB+DBR+ZD (4).pdf` | Material de relevamiento/diseño histórico (HTML/PDF/XLSX/CSV) de proyectos anteriores (6 y 7) | **MOVIDOS (2026-07-04)** de `docs/` a `docs/legacy/` vía `git mv` (0 referencias cruzadas confirmadas antes de mover, re-verificado después del movimiento con un grep de cada nombre de archivo contra todo el repo - ninguna quedó rota) | NO |
| `docs/VISUAL_REDESIGN_EYG.md` | Es un changelog de un sprint de rediseño puntual ("antes/después"), no un doc de referencia continua - `DASHBOARD_VISUAL_STYLE.md` es el doc vivo equivalente hoy | Mantener como historial en `docs/` (es un `.md` activo, no se movió); aclarar en el propio doc que es un snapshot de sprint | NO |
| `docs/BI_READINESS.md` | Contiene una afirmación desactualizada: dice que "no se construyó ningún dashboard todavía", pero `/dashboard/operacional` y otras vistas ya existen y están documentadas en `DASHBOARD_VISUAL_STYLE.md` | Actualizar la afirmación en una futura pasada de docs (no en esta auditoría) | NO |
| `docs/PHASE_1_CLOSEOUT.md`, `docs/SCOPE_AND_LIMITATIONS.md`, `docs/KNOWN_LIMITATIONS_PHASE_1.md`, `docs/PHASE_2_BACKLOG.md`, `docs/PHASE_2_HANDOFF.md` | Snapshots de un punto en el tiempo (cierre de Fase 1 / planeación de Fase 2) - los números que citan (628 tickets, 3747 reportes, 291 tickets 403, etc.) están congelados a esa fecha | Mantener como historial/handoff - son útiles tal como son, solo hay que leerlos sabiendo que son snapshots, no métricas en vivo | NO |
| `README.md` (raíz) | Contenido real: `# Nexus` (una línea) - no describe el proyecto en absoluto | Expandir en una futura pasada de docs para que apunte a `CLAUDE.md`/`PROJECT_INDEX.md` (no se edita en esta auditoría porque no es un archivo generado por el script de auditoría, y esta tarea es de registro, no de redacción de docs existentes) | NO |

## 5. Archivos que deberían estar en `.gitignore` (o ya cubiertos, verificar)

| Patrón | Estado actual | Motivo | Acción recomendada | ¿Borrar ahora? |
|---|---|---|---|---|
| `.env` | Ya en `.gitignore` | Secretos de las 3 APIs | Ninguna - correcto | NO |
| `data/raw/` | Ya en `.gitignore` | RAW inmutable, puede ser grande y no aporta valor versionado | Ninguna - correcto | NO |
| `data/warehouse/` (incluye `.duckdb`/`.wal`) | Ya en `.gitignore` | Binario reconstruible, no debe versionarse | Ninguna - correcto | NO |
| `node_modules/` (raíz y `apps/nexus-bi-app/`) | Ya en `.gitignore` (patrón sin slash inicial cubre ambos) | Dependencias | Ninguna - correcto | NO |
| `.next/` (raíz del patrón, cubre `apps/nexus-bi-app/.next/`) | Ya en `.gitignore` | Build de Next.js | Ninguna - correcto | NO |
| `apps/nexus-bi-app/tsconfig.tsbuildinfo` | **RESUELTO (2026-07-04)** - se agregó `*.tsbuildinfo` a `.gitignore` | Caché incremental de `tsc`, se regenera en cada typecheck, no aporta valor versionado | Ninguna - ya cubierto | NO |
| `docs/levantamiento_maestro.pdf` (20MB) | Sí versionado hoy | No es generado ni secreto, pero es un binario pesado (el más grande del repo) dentro de `docs/` | Evaluar si conviene Git LFS o simplemente aceptar el peso - es material de referencia legítimo, no basura | NO |

## 6. Revisión de `possible_secret_hits` (2026-07-04)

Los 4 hits reportados por `npm run audit:structure` en la auditoría inicial se revisaron manualmente, sin imprimir ningún valor. **Los 4 son falsos positivos** - no había ningún secreto real hardcodeado en ningún archivo versionado:

| Archivo | Qué matcheó el patrón básico | Por qué es falso positivo |
|---|---|---|
| `src/miners/dolibarr.js` | Un header HTTP llamado `DOLAPIKEY` (contiene "API"+"KEY") asignado a una variable | La variable es `DOLIBARR_TOKEN`, desestructurada de `process.env` en la línea de arriba - es una **referencia** a una variable de entorno, no un valor literal. `DOLIBARR_TOKEN` en sí nunca tiene un valor hardcodeado en el archivo |
| `src/miners/fieldbeat-all.js` | La palabra "token" dentro de identificadores (`nextPageToken`, `buildFieldBeatUrl`) y un comentario | `nextPageToken` es una variable que guarda el cursor de paginación (`next_page`) que devuelve la propia API - no es una credencial, es un valor de paginación público dentro de la respuesta |
| `docs/P4.gs.txt` | `const DOLIBARR_API_KEY = SCRIPT_PROPERTIES.getProperty('DOLIBARR_API_KEY');` | Lee el valor desde `PropertiesService` de Google Apps Script (almacenamiento seguro de secretos de Apps Script) - el string literal `'DOLIBARR_API_KEY'` es el **nombre de la propiedad**, no el secreto en sí |
| `docs/P5.txt` | Misma línea que P4.gs.txt (mismo patrón de `SCRIPT_PROPERTIES.getProperty(...)`) | Igual que arriba - nombre de propiedad, no secreto |

Verificación adicional: se buscaron también patrones de string literal tipo base64/hex largo (24+ caracteres entre comillas) en `P4.gs.txt` y `P5.txt` - **cero coincidencias**. No se encontró ningún valor real sensible que mover a `.env`/`.env.example`. No se modificó ningún archivo por este punto (no había nada que corregir).

## 7. Resumen de riesgo por hallazgo (actualizado 2026-07-04)

| Hallazgo | Estado | Riesgo residual |
|---|---|---|
| `nodenpm` vacío | Sin cambios - sigue sin uso conocido | Ninguno - no lo usa nada |
| `src/request.http` duplicado/mal nombrado | Sin cambios - sigue huérfano | Ninguno funcional - podría confundir a un desarrollador nuevo |
| `src/miners/fieldbeat.js` con bug | **RESUELTO** - deprecado explícitamente, ya no lanza `ReferenceError` | Ninguno - `npm run get:fieldbeat` ahora falla con un mensaje claro en vez de un crash confuso |
| `EmptyState.tsx`/`FilterPanel.tsx` huérfanos | Sin cambios - re-confirmados huérfanos | Ninguno - código muerto no ejecutado |
| `data/config/`↔`data/curation/` alias duplicados | Sin cambios - documentado como deliberado | Confusión para quien no lea `CLAUDE.md`/`CURATION_MODEL.md` |
| 9 archivos legacy sin referencias | **RESUELTO** - movidos a `docs/legacy/` vía `git mv` | Ninguno - se verificó ausencia de referencias antes y después del movimiento |
| `P4.gs.txt`/`P5.txt`/`Documentación Proyecto 4.md` | Sin cambios - deliberadamente NO movidos (referenciados desde otros docs) | Ninguno - siguen en `docs/` raíz, accesibles como siempre |
| `*.tsbuildinfo` sin ignorar | **RESUELTO** - agregado a `.gitignore` | Ninguno |
| `possible_secret_hits` (4) | **RESUELTO** - los 4 confirmados como falsos positivos | Ninguno - no había secretos reales que mover |
| Docs desactualizados (`BI_READINESS.md`, etc.) | Sin cambios - fuera de alcance de esta pasada | Un lector nuevo se forma un modelo mental incorrecto del estado del proyecto |
