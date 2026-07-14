# 00 -Norte de producto

Escrito al final del proceso de auditoría, apoyado en `01`-`08`/`11`/`12` ya cerrados -no al revés, para no inventar alcance antes de tener el inventario.

## Problema que resuelve Nexus (AS_IS)

EyG opera servicio técnico sobre equipamiento médico de alta tecnología (radioterapia/imagenología -LINAC, braquiterapia, CT, RX, confirmado por tipo de equipo en `docs/DATA_DICTIONARY.md:161`, no por datos de paciente -ver `12-security-privacy-accessibility.md`). Antes de Nexus, esa operación se registraba en tres sistemas desconectados -Zendesk (tickets), FieldBeat (reportes de terreno) y Dolibarr (catálogo/inventario) -sin ningún cruce automático entre ellos, según el propio linaje documentado del proyecto (Proyecto 4→5→6→7, planillas planas, `docs/Documentación Proyecto 4.md`, `docs/P4.gs.txt`, `docs/P5.txt`, `CLAUDE.md` histórico). Nexus reconstruye la cadena real de negocio -*un ticket genera un trabajo → el trabajo se ejecuta y reporta en terreno → el reporte usa repuestos → esos repuestos deben identificarse contra el catálogo* -en un pipeline reproducible con capas RAW→PROCESSED→MARTS→GOLD, y expone lecturas agregadas de esa cadena en 3 dashboards. STATIC_DOC `docs/ARCHITECTURE.md:31-41`.

## Usuarios (ver detalle y salvedades en `02-users-roles-and-tasks.md`)

No hay usuarios humanos confirmados en runtime -cero telemetría, cero sesiones. Las personas inferidas (analista BI/gerencia operacional, técnico de terreno, agente Zendesk, bodeguero, "responsable de calidad de datos") son **PROPUESTA**, nunca CONFIRMADA. La única condición de acceso real hoy es binaria: público anónimo vs. caller server-to-server con token -ninguno de los dos es una persona de negocio (regla dura de `02`).

## Decisiones que Nexus permite tomar hoy (AS_IS, con alcance limitado -ver `05`)

- Volumen de trabajo FieldBeat por cliente/equipo/período, sin depender de si hay ticket Zendesk asociado (`/dashboard/fieldbeat`).
- Cruce ticket↔trabajo↔repuesto para el subconjunto de tickets Zendesk accesibles -**hoy solo 7.74% de los reportes tienen un ticket accesible** (confirmado LOCAL_RUNTIME, `pctConTicketAccesible`), no el 100% del historial operativo.
- Identificación de patrones de trabajo fuera de horario laboral, con score de confianza metodológica explícito (nunca presentado como probabilidad estadística -auto-disclaimer en código y en pantalla).
- Backlog de calidad de dato que necesita curación manual (repuestos ambiguos/placeholder, tickets sin vínculo válido) -**solo como lista de lectura hoy**, sin acción ejecutable (ver D6 en `11-product-decision-register.md`).

## Lo que Nexus explícitamente NO permite tomar todavía

- Ninguna decisión de disponibilidad de equipo real ("uptime/downtime" clásico) -la propia API devuelve `downtimeWarning:true` y campos `hcCalc/uptimePct/tha/hcTeorica` fijos en `null`.
- Ninguna acción de curación de datos ejecutable desde la UI (todo botón de "Auditoría" está deshabilitado).
- Ninguna decisión de reposición de stock automática -`stock.stock_movements` es scaffolding sin escritor (TO_BE).

## Diferenciación

Frente a su predecesor directo (Proyecto 4/5/6/7, planillas y Apps Script ad hoc con lógica de negocio dispersa en un script de Gmail-trigger), la diferenciación de Nexus es **arquitectónica, no de alcance de negocio todavía**: capas de datos versionadas y reproducibles, vocabulario de calidad de dato explícito y consistente (`match_status`, `report_quality_status`, `zendesk_join_status` -ver `05`), y autolimitación declarada en vez de números presentados como completos. Nexus no cubre hoy más terreno de negocio que P4/P5 (p. ej., P4 sí ejecutaba descuentos reales de stock en Dolibarr; Nexus todavía no -ver `01`§D) -la diferenciación real está en la trazabilidad y la calidad de dato explícita, no en funcionalidad nueva.

## Límites explícitos del producto

### La brecha más grande: CERBERUS/JANUS/ATLAS -prometidos, no construidos bajo ese nombre

`docs/legacy/relevamiento_maestro_nexus_cerberus.html` documenta un contrato cerrado de Fase 1 ("$3.000.000 CLP", "Alcance: TODO NEXUS + TODO CERBERUS") donde **CERBERUS** es un motor formal de calidad de reportes (fórmula ponderada `integridad_reporte`, clasificación apto/parcial/dudoso/no apto) y una Fase 2 proyectada **JANUS** (uptime/downtime con confianza) + **ATLAS** (base operacional unificada). Búsqueda exhaustiva del código y documentación vigente (`git grep -i "cerberus\|janus\|atlas" 4a3d055 -- . ':!docs/legacy'`) devuelve **0 resultados**. Lo más cercano que existe hoy es el enum simple `data_quality_status`/`report_quality_status` -una fracción de lo que CERBERUS describía formalmente. **Estado: LEGACY en el código actual, COMMITTED como compromiso contractual** -no descartado, ver `11-product-decision-register.md` entradas D1/D2. Cualquier trabajo de diseño no debe asumir que CERBERUS/JANUS/ATLAS ya están resueltos ni que fueron abandonados -es una decisión abierta del dueño de producto.

### Segunda contradicción relevante: arquitectura Cloudflare vs. stack real Supabase+Netlify

Dos documentos HTML en la raíz del repo (`readme-arquitectural.html`, `target-architecture-cloudflare.html`) presentan una migración a Cloudflare Edge como plan vigente ("En curso", próximo hito). Es **LEGACY** -`docs/ARCHITECTURE.md:64-74` documenta con precisión que esa migración se congeló (R2 exige tarjeta, el proyecto debe mantenerse cardless) y fue reemplazada por Supabase+Netlify, la que efectivamente corre hoy (confirmado LOCAL_RUNTIME en esta auditoría). Ningún archivo de `docs/design-context/` debe citar esos dos HTML como arquitectura vigente.

### Alcance de datos -GOLD v1 es un universo parcial, no el historial completo

628 tickets Zendesk vs. 3.747 tareas FieldBeat; 68% de las tareas nunca registraron número de ticket; solo 200 de 2.193 repuestos (9%) llegan al mart ticket-céntrico; 291 tickets permanentemente inaccesibles por permisos de token (403, no 404). Cifras STATIC_DOC (`docs/SCOPE_AND_LIMITATIONS.md`) confirmadas de nuevo LOCAL_RUNTIME en esta sesión (`04-data-and-api-contracts.md`). **No se debe presentar ningún número de Nexus como "el 100% del historial operativo"** -es el límite explícito más citado del propio proyecto.

### Fase declarada por el producto mismo

`NavBar.tsx:76-78`: "Fase 1 MVP - solo lectura" -el propio producto se autodeclara de solo lectura, consistente con que ninguna de las 7 pantallas de producto tiene una acción de escritura real conectada.

## Fuentes

`docs/ARCHITECTURE.md`, `docs/SCOPE_AND_LIMITATIONS.md`, `docs/legacy/relevamiento_maestro_nexus_cerberus.html`, `docs/Documentación Proyecto 4.md`, `docs/P4.gs.txt`, `docs/P5.txt`, `NavBar.tsx`, `01`, `02`, `05`, `11`, `12`, sondeo LOCAL_RUNTIME de esta sesión.
