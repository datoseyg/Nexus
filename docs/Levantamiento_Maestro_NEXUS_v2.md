<div class="cover">

<div class="cover-kicker">E&G MEDICAL SYSTEMS · NEXUS</div>

# Levantamiento Maestro NEXUS v2.0

## Baseline de cierre, demo productiva controlada y continuidad de desarrollo

<div class="cover-rule"></div>

**Documento maestro de alcance funcional, arquitectura vigente, prioridades, criterios de aceptación y plan de liberación**

| Control | Definición |
|---|---|
| Versión | 2.0 |
| Fecha de emisión | 20 de julio de 2026 |
| Fecha límite de demo | Martes 21 de julio de 2026, 15:00 CLT |
| Plataforma objetivo | Supabase + Netlify, sin tarjeta bancaria |
| Rama de producción | `main` |
| Rama de desarrollo | `Frontend-Rev` |
| Autor / responsable técnico | Ignacio Reyes Toledo |
| Estado | Baseline operativa para ejecución inmediata |

<div class="cover-note">
Este documento sustituye como baseline vigente al Levantamiento Maestro NEXUS + CERBERUS Fase 1 del 30 de junio de 2026. El documento original se conserva como antecedente histórico y fuente de trazabilidad, pero deja de gobernar la arquitectura y las prioridades actuales.
</div>

</div>

<div class="page-break"></div>

# Control del documento

| Campo | Contenido |
|---|---|
| Nombre | Levantamiento Maestro NEXUS v2.0 |
| Naturaleza | Especificación funcional-técnica, baseline de producto y plan de liberación |
| Audiencia primaria | Gerencia, Administración, responsable técnico y futuros colaboradores de desarrollo |
| Audiencia secundaria | Operaciones, soporte, técnicos de terreno y TI |
| Horizonte inmediato | Demo productiva controlada antes del martes 21 de julio de 2026 a las 15:00 CLT |
| Horizonte posterior | Evolución local de NEXUS v1.1 y v2 sin interrumpir la versión estable en producción |
| Fuentes principales | Levantamiento Maestro v1; repositorio NEXUS; documentación de arquitectura, datos, alcance, diseño y despliegue; certificaciones recientes de FieldBeat y After-Hours |
| Restricción económica-operativa | Todo el despliegue debe poder operar sin registrar tarjeta bancaria |
| Restricción de seguridad | La demo usa datos reales procesados y debe permanecer autenticada, en modo lectura y sin exponer capas técnicas ni credenciales |

## Historial de cambios

| Versión | Fecha | Cambio principal |
|---|---:|---|
| 1.0 | 30-06-2026 | Levantamiento inicial NEXUS + CERBERUS, arquitectura BigQuery / Apps Script / Sheets / Looker Studio |
| 2.0 | 20-07-2026 | Rebaseline completa hacia Node.js, DuckDB, PostgreSQL/Supabase, Next.js y Netlify; prioridad de demo gerencial usable; CERBERUS reducido e integrado dentro de NEXUS |

## Reglas de interpretación

1. La **demo productiva controlada** es una versión estable, autenticada y usable por Gerencia y Administración con un snapshot real procesado. No equivale todavía a una plataforma productiva automatizada, escribible y con operación 24/7.
2. Todo requisito marcado como **P0** bloquea la liberación.
3. Todo requisito marcado como **P1** debe intentarse antes del cierre, pero puede pasar a la primera iteración local posterior cuando su implementación ponga en riesgo los P0.
4. Lo que no esté respaldado por datos reales no debe fingirse, estimarse desde rankings parciales ni copiarse desde mockups.
5. Una capacidad incompleta no debe mostrarse como un bloque vacío ante Gerencia. Debe implementarse o permanecer oculta mediante una decisión explícita de alcance.

# Contenido

1. [Resumen ejecutivo](#resumen-ejecutivo)
2. [Propósito de NEXUS v2](#1-propósito-de-nexus-v2)
3. [Cambios respecto del levantamiento maestro v1](#2-cambios-respecto-del-levantamiento-maestro-v1)
4. [Principios de producto](#3-principios-de-producto)
5. [Usuarios, roles y permisos](#4-usuarios-roles-y-permisos)
6. [Alcance de pantallas de la demo](#5-alcance-de-pantallas-de-la-demo)
7. [Capacidades transversales obligatorias](#6-capacidades-transversales-obligatorias)
8. [Arquitectura oficial NEXUS v2](#7-arquitectura-oficial-nexus-v2)
9. [Integración NEXUS + CERBERUS reducido](#8-integración-nexus--cerberus-reducido)
10. [Datos y alcance analítico](#9-datos-y-alcance-analítico)
11. [Seguridad, autenticación y autorización](#10-seguridad-autenticación-y-autorización)
12. [Entornos, ramas y control de releases](#11-entornos-ramas-y-control-de-releases)
13. [Estrategia de actualización de datos](#12-estrategia-de-actualización-de-datos)
14. [Priorización reorganizada](#13-priorización-reorganizada)
15. [Plan de ejecución de cierre](#14-plan-de-ejecución-de-cierre)
16. [Requisitos funcionales](#15-requisitos-funcionales)
17. [Requisitos no funcionales](#16-requisitos-no-funcionales)
18. [Calidad y estrategia de pruebas](#17-calidad-y-estrategia-de-pruebas)
19. [Criterios de aceptación de la demo](#18-criterios-de-aceptación-de-la-demo)
20. [Riesgos y mitigaciones](#19-riesgos-y-mitigaciones)
21. [Decisiones arquitectónicas registradas](#20-decisiones-arquitectónicas-registradas)
22. [Backlog posterior a la demo](#21-backlog-posterior-a-la-demo)
23. [Entregables de la liberación](#22-entregables-de-la-liberación)
24. [Guía de presentación a Gerencia y Administración](#23-guía-de-presentación-a-gerencia-y-administración)
25. [Glosario ejecutivo](#24-glosario-ejecutivo)
26. [Conclusión](#25-conclusión)
27. [Anexos](#anexo-a--checklist-operativo-de-liberación)

<div class="page-break"></div>

# Resumen ejecutivo

NEXUS dejó de ser una propuesta de integración basada en Google Apps Script y BigQuery. Actualmente es una plataforma analítica construida con un pipeline Node.js, capas de datos RAW → PROCESSED → MARTS → GOLD, warehouse local DuckDB, sincronización a PostgreSQL/Supabase, APIs server-side y una aplicación Next.js con dashboards y herramientas de consulta.

La prioridad del proyecto cambia desde la expansión técnica hacia una **liberación demostrable, estable y comprensible para usuarios no técnicos**. La versión que se liberará esta semana debe permitir que Gerencia y Administración conozcan las capacidades reales de la aplicación, naveguen, filtren, busquen, exploren, abran detalles y descarguen información utilizando datos reales ya depurados por los motores de procesamiento de NEXUS.

La demo no expondrá datos RAW. Mostrará datos reales normalizados, deduplicados, enriquecidos y clasificados. Los errores corregibles por procesamiento —por ejemplo, variantes de escritura, identificadores con formato inconsistente, repuestos reconocidos por reglas de matching o relaciones recuperables entre sistemas— deben presentarse en su versión canónica y explicable.

La primera prioridad de desarrollo es completar las nuevas visualizaciones de los mockups pendientes:

1. **Auditoría**.
2. **Explorador de negocio**.

Después se cerrarán los bloqueadores de demo: autenticación, eliminación de estados incompletos visibles, filtros y detalles realmente operativos, descarga de información, congelamiento del snapshot de datos, despliegue cardless en Supabase + Netlify y validación final con las dos cuentas de negocio.

El modelo oficial de continuidad será:

```text
PRODUCCIÓN (main)
Versión estable + datos controlados + usuarios de Gerencia y Administración

DESARROLLO LOCAL (Frontend-Rev)
Nuevas capacidades + refactors + CERBERUS ampliado + automatización

PROMOCIÓN
Frontend-Rev → validación → merge controlado → main → Netlify
```

## Veredicto de situación

| Frente | Estado al emitir v2 | Decisión |
|---|---|---|
| Pipeline y capas de datos | Maduro | Congelar; no refactorizar antes de la demo |
| Dashboard Inicio | Implementado | Validar y ajustar lenguaje ejecutivo |
| Dashboard Operacional | Implementado | Mantener; certificar filtros, detalles y descarga |
| Dashboard FieldBeat | Frontend implementado; datos analíticos aún parciales | Completar datos simples o esconder bloques incompletos de producción |
| Trabajo fuera de horario | Implementado y certificado | Mantener estable |
| Auditoría | Mockup pendiente de implementación final | Prioridad 1 |
| Explorador | Existe base técnica, pero no experiencia de negocio | Prioridad 1 |
| Búsqueda | Implementada | Validar resultados, detalle y vocabulario |
| Autenticación y roles | Pendiente | Bloqueador P0 |
| Despliegue productivo | Runbook disponible; liberación final pendiente | Bloqueador P0 |
| CERBERUS | Parcial y fragmentado | Integrarlo como núcleo reducido de calidad dentro de NEXUS |
| Escrituras administrativas | Backend parcial; UI no disponible | Fuera de la demo |

# 1. Propósito de NEXUS v2

## 1.1 Propósito del producto

NEXUS debe entregar una vista operacional confiable y entendible del servicio técnico de E&G Medical Systems, integrando información proveniente de:

- FieldBeat: ejecución técnica, tareas y reportes de terreno.
- Zendesk: tickets y demanda de soporte.
- Dolibarr: catálogo de productos, repuestos e inventario disponible.
- Contratos y reglas operativas: horarios, cobertura, condiciones por cliente y equipos asociados.

La plataforma debe transformar datos dispersos y de calidad variable en información útil para responder, sin conocimiento técnico, preguntas como:

- ¿Cuánta actividad de terreno se registra y cómo se distribuye?
- ¿Qué clientes y equipos concentran la operación?
- ¿Qué reportes están vinculados con tickets y cuáles no?
- ¿Qué repuestos fueron usados y qué tan bien están identificados?
- ¿Qué actividad ocurrió fuera de horario?
- ¿Qué información está incompleta o requiere revisión?
- ¿Dónde puedo encontrar el detalle de un cliente, equipo, técnico, ticket, reporte o repuesto?
- ¿Qué contratos existen y qué condiciones operativas se asocian a cada cliente?

## 1.2 Objetivo de la demo productiva controlada

Liberar antes del martes 21 de julio de 2026 a las 15:00 CLT una versión que:

- sea accesible mediante login;
- use dos cuentas separadas, Gerencia y Administración;
- opere con datos reales procesados;
- no exponga datos crudos ni terminología de arquitectura;
- permita navegación, filtros, búsqueda, exploración, detalle y descarga;
- no permita correcciones, cambios contractuales, movimientos de stock ni otras escrituras;
- muestre fecha y hora del snapshot disponible;
- tenga una experiencia visual coherente con los mockups aprobados;
- pueda utilizarse libremente como demostración interna mientras el desarrollo continúa en local.

## 1.3 Objetivos secundarios

- Demostrar el valor de la integración entre plataformas.
- Hacer visible la calidad y trazabilidad de los datos sin exigir conocimientos de BI o bases de datos.
- Establecer una rama productiva estable y una rama local de evolución.
- Reducir la incertidumbre sobre el estado real del proyecto.
- Convertir la arquitectura actual en la baseline oficial.

## 1.4 No objetivos de esta liberación

Quedan fuera de la demo de esta semana:

- edición o corrección de datos;
- creación de aliases desde la interfaz;
- resolución de incidentes de auditoría;
- modificación de contratos u horarios;
- movimientos de stock;
- actualización automática o en tiempo real;
- autoservicio de creación de cuentas;
- permisos personalizados por persona;
- administración de usuarios;
- CERBERUS completo con todas las dimensiones y ponderaciones originales;
- automatización integral del pipeline;
- operación multiempresa o acceso de clientes externos.

# 2. Cambios respecto del levantamiento maestro v1

## 2.1 Cambio de arquitectura

| Dimensión | Levantamiento v1 | Baseline v2 |
|---|---|---|
| Lenguaje y orquestación | Google Apps Script | Node.js modular y scripts CLI |
| Warehouse principal de desarrollo | BigQuery | DuckDB local |
| Base de serving | BigQuery / Sheets | PostgreSQL en Supabase |
| Frontend | Looker Studio | Next.js App Router |
| Hosting | Ecosistema Google | Netlify |
| Consola de gobierno | Google Sheets | Interfaces Next.js + APIs administrativas |
| RAW | Cloud Storage previsto | Archivos JSON locales versionados por timestamp, fuera de Git |
| Integración | Scripts orientados a hojas | Pipeline por capas con contratos de datos |
| Despliegue | Apps Script / Looker | Serverless Next.js + Supabase |
| Costos | Sujeto a servicios Google | Estrategia cardless; no se registrará tarjeta |

El cambio es positivo en modularidad, pruebas, control de producto y mantenibilidad. La principal deuda no es técnica, sino documental: la nueva arquitectura debía formalizarse. Este documento resuelve esa brecha.

## 2.2 Cambio de alcance de CERBERUS

CERBERUS deja de tratarse como un producto separado de igual tamaño que NEXUS. Se redefine como un **motor reducido de calidad, confianza y priorización incorporado dentro de NEXUS**.

En la demo, CERBERUS aportará:

- estados de calidad de reportes;
- identificación de información incompleta;
- clasificación de matching de repuestos;
- vínculos de tickets faltantes, restringidos o inexistentes;
- indicadores y filtros de auditoría;
- explicación de causas y conteos;
- priorización visual de problemas.

No se compromete todavía:

- score ponderado completo de seis dimensiones;
- clasificación formal Apto / Parcialmente apto / Dudoso / No apto para todo el universo;
- flujo de corrección y reprocesamiento;
- asignación de casos a usuarios;
- historial completo de resoluciones humanas.

## 2.3 Cambio de prioridad

La prioridad ya no es expandir el modelo técnico antes de mostrar resultados. El orden vigente es:

1. Completar visualizaciones de Auditoría y Explorador.
2. Liberar una demo usable y segura.
3. Corregir o esconder capacidades incompletas visibles.
4. Estabilizar producción.
5. Continuar la evolución local.
6. Completar CERBERUS y gobernanza después de demostrar valor.

# 3. Principios de producto

## 3.1 Lenguaje de negocio

La interfaz no debe mostrar términos como:

- GOLD;
- MARTS;
- PROCESSED;
- schema;
- tabla SQL;
- endpoint;
- foreign key;
- pipeline interno.

Debe utilizar términos como:

- Reportes de terreno.
- Tickets de soporte.
- Clientes.
- Equipos.
- Técnicos.
- Repuestos.
- Contratos.
- Calidad de información.
- Actividad fuera de horario.

## 3.2 Datos reales, no datos crudos

La demo utiliza datos reales completos disponibles para el proyecto, pero presentados después del procesamiento de NEXUS. Esto incluye:

- normalización de nombres;
- deduplicación por identificador;
- limpieza de formatos;
- recuperación de relaciones interpretables;
- matching de repuestos contra catálogo;
- clasificación de registros incompletos o ambiguos;
- agregaciones y métricas derivadas.

La aplicación debe poder explicar que una cifra es el resultado de un proceso de integración y control de calidad, no una copia directa de una planilla.

## 3.3 Honestidad analítica

- No se inventan valores.
- No se copian cifras de mockups.
- No se usa el tamaño de un top-10 como total del universo.
- No se presenta un ranking de consumo como ranking de atenciones.
- No se ocultan restricciones importantes de alcance.
- No se llama “historial completo de Zendesk” al universo accesible cuando existen tickets restringidos por permisos.

## 3.4 Cero estados incompletos visibles en la demo

La producción no debe exhibir mensajes repetidos como “Información todavía no disponible”. Cada bloque debe cumplir una de estas dos condiciones:

1. Está respaldado por datos reales y funciona.
2. Está oculto en producción mediante configuración o feature flag.

Los placeholders pueden mantenerse en la rama de desarrollo para conservar la estructura futura del mockup, pero no deben degradar la percepción de la demo gerencial.

## 3.5 Lectura segura

La demo será de solo lectura. La ausencia de escrituras es una decisión de seguridad y alcance, no una limitación accidental.

# 4. Usuarios, roles y permisos

## 4.1 Usuarios objetivo

### Gerencia

Necesita una visión ejecutiva, capacidad de navegar entre indicadores, reconocer riesgos, abrir evidencias y descargar información para análisis o presentación.

### Administración

Necesita la misma visibilidad general, con mayor énfasis en registros operativos, auditoría, búsqueda, contratos, detalles y exportación.

## 4.2 Modelo de cuentas para la demo

Se crearán dos cuentas preaprovisionadas:

| ID visible | Rol | Propósito |
|---|---|---|
| `GERENCIA` | Gerencia | Navegación ejecutiva completa |
| `ADMINISTRACION` | Administración | Navegación ejecutiva y detalle operacional completo |

La pantalla mostrará “ID de usuario” y “Contraseña”. La implementación interna podrá utilizar Supabase Auth con una identidad técnica asociada, sin exponer el correo o identificador interno al usuario.

No habrá registro público ni recuperación automática de contraseña durante la demo. El responsable técnico entregará las credenciales por un canal controlado y podrá rotarlas.

## 4.3 Matriz de permisos

| Capacidad | Gerencia | Administración |
|---|:---:|:---:|
| Inicio | Sí | Sí |
| Dashboard Operacional | Sí | Sí |
| Dashboard FieldBeat | Sí | Sí |
| Trabajo fuera de horario | Sí | Sí |
| Auditoría en lectura | Sí | Sí |
| Explorador de negocio | Sí | Sí |
| Búsqueda global | Sí | Sí |
| Abrir detalles | Sí | Sí |
| Descargar informes | Sí | Sí |
| Ver contratos | Sí, resumen | Sí, resumen y detalle |
| Corregir datos | No | No |
| Resolver auditorías | No | No |
| Modificar contratos | No | No |
| Registrar stock | No | No |
| Administrar usuarios | No | No |

La diferencia inicial entre ambos roles puede expresarse mediante la profundidad por defecto y la pantalla de inicio, sin inventar permisos de escritura.

# 5. Alcance de pantallas de la demo

## 5.1 Inventario y estado

| Pantalla | Ruta | Estado actual | Estado exigido para demo | Prioridad |
|---|---|---|---|---:|
| Login | `/login` | No disponible | Implementado y obligatorio | P0 |
| Inicio | `/` | Implementado | Validado y con fecha de datos | P0 |
| Dashboard Operacional | `/dashboard/operacional` | Implementado | Filtros, detalle y descarga certificados | P0 |
| FieldBeat | `/dashboard/fieldbeat` | Frontend implementado; analítica parcial | Sin placeholders visibles; datos o bloques ocultos | P0 |
| Trabajo fuera de horario | `/dashboard/after-hours` | Implementado | Estable, filtrable y descargable | P0 |
| Auditoría | `/audit/manual-review` | Interfaz anterior / mockup pendiente | Nueva visualización implementada | Prioridad 1 / P0 |
| Explorador | `/explorer` | Base técnica orientada a tablas | Explorador de negocio comprensible | Prioridad 1 / P0 |
| Búsqueda | `/search` | Implementada | Certificada y con detalle | P0 |
| Administración | No existe | No disponible | Fuera de alcance | P2 |

## 5.2 Inicio

Debe explicar qué hace NEXUS sin lenguaje técnico y actuar como punto de entrada.

Requisitos mínimos:

- saludo o encabezado según rol;
- resumen de capacidades disponibles;
- accesos a dashboards, auditoría, explorador y búsqueda;
- fecha del snapshot;
- estado general del sistema;
- descripción breve de cada sección;
- ausencia de accesos a funciones no implementadas.

## 5.3 Dashboard Operacional

Debe presentar una lectura integrada del servicio y permitir:

- aplicar filtros soportados por el contrato actual;
- abrir detalle de indicadores y registros;
- distinguir tickets, reportes y repuestos;
- ver alcance y advertencias de datos;
- descargar el resultado filtrado;
- mantener consistencia entre KPI, gráficos y tabla.

## 5.4 Dashboard FieldBeat

La interfaz visual ya fue reescrita según el mockup. Antes de producción se aplicará la regla:

```text
Dato real disponible → mostrar.
Dato real implementable sin riesgo → implementar.
Dato no disponible o riesgoso → ocultar el bloque en producción.
```

Los primeros datos a completar son:

1. clientes con actividad;
2. equipos atendidos;
3. actividad más reciente;
4. evolución mensual;
5. tipo de trabajo predominante.

Los cruces cliente × máquina, cliente × tipo de tarea y el detalle de últimos reportes se consideran P1. Cuando no alcancen el gate de datos y pruebas, se ocultarán en producción y permanecerán en `Frontend-Rev`.

## 5.5 Trabajo fuera de horario

La pantalla debe conservar:

- resumen general;
- análisis temporal;
- clientes;
- técnicos;
- tipo de tarea;
- día y hora;
- confianza de cobertura;
- detalle de tareas;
- filtros consistentes;
- exportación.

No deben alterarse sus reglas de contrato, calendario, feriados o zonas horarias durante el cierre de demo salvo un defecto bloqueante reproducido.

## 5.6 Auditoría

Auditoría será una herramienta de observación y priorización, no de corrección.

### Preguntas de negocio

- ¿Qué información presenta problemas?
- ¿Cuántos registros están afectados?
- ¿Qué tipo de problema es el más frecuente?
- ¿Qué clientes, técnicos, equipos o fuentes concentran incidencias?
- ¿Cuál es el impacto y qué evidencia existe?
- ¿Qué registros específicos requieren revisión?

### Estructura mínima

- resumen de salud de datos;
- categorías de incidencia;
- severidad o prioridad comprensible;
- filtros por tipo, origen, cliente, técnico y período cuando estén soportados;
- lista de registros afectados;
- panel de detalle;
- explicación de la regla que disparó la incidencia;
- descarga del conjunto filtrado;
- indicadores separados para tickets, repuestos, reportes y pipeline.

### Acciones prohibidas en demo

- marcar resuelto;
- asignar responsable;
- crear alias;
- modificar vínculo de ticket;
- editar registro de origen;
- reprocesar.

Los botones de acción que aparezcan en el mockup deben eliminarse, ocultarse o quedar inequívocamente no disponibles. No deben simular funcionamiento.

## 5.7 Explorador de negocio

El Explorador no expondrá schemas ni nombres de tablas. Será una experiencia orientada a entidades de negocio.

### Entidades objetivo

- Reportes de terreno.
- Tickets de soporte.
- Repuestos.
- Clientes.
- Equipos.
- Técnicos.
- Contratos, cuando el dataset quede validado.

### Modos de visualización

- vista de tarjetas o resumen;
- vista tabular opcional;
- filtros por campos relevantes;
- búsqueda dentro de la entidad;
- ordenamiento;
- paginación;
- detalle lateral o modal;
- relaciones con otras entidades;
- descarga del resultado actual.

### Ejemplo de navegación relacional

```text
Cliente
  ├─ Equipos asociados
  ├─ Reportes de terreno
  ├─ Tickets de soporte
  ├─ Repuestos utilizados
  └─ Contratos y horarios aplicables
```

### Reglas de abstracción

- “gold.fieldbeat_report_analysis” se presenta como “Reportes de terreno”.
- “mart” se presenta como una relación o vista de negocio, no como capa técnica.
- Los identificadores internos aparecen solo cuando son útiles para trazabilidad.
- Cada campo debe tener etiqueta humana y formato correcto.
- Los valores nulos deben interpretarse: “Sin ticket asociado”, “No informado”, “No identificable”, etc.

## 5.8 Búsqueda

Debe permitir búsqueda global por:

- cliente;
- equipo;
- técnico;
- ticket;
- reporte;
- repuesto, SKU, REF o barcode;
- contrato, cuando esté disponible.

Los resultados se agrupan por entidad y deben abrir un detalle consistente con el Explorador.

# 6. Capacidades transversales obligatorias

## 6.1 Filtros

Todo filtro visible debe estar respaldado por el backend. Los filtros deben:

- modificar KPI, gráficos y tablas de forma consistente;
- conservarse durante la navegación interna cuando corresponda;
- tener una acción clara de limpieza;
- mostrarse en términos de negocio;
- no emitir solicitudes duplicadas o obsoletas;
- reflejar el universo actual después de aplicarse.

No se publicarán controles deshabilitados que aparenten capacidad futura, salvo una explicación puntual de alcance aprobada.

## 6.2 Detalle

Los detalles deben incluir:

- identidad del registro;
- contexto de cliente y equipo;
- fecha y hora;
- origen;
- ticket asociado;
- técnico;
- tipo de tarea;
- repuestos;
- estado de calidad;
- vínculos con entidades relacionadas.

La disponibilidad de cada campo depende del origen real. No se fabricarán valores para completar una ficha.

## 6.3 Descarga

La demo debe permitir descarga real.

### Mínimo obligatorio

- CSV para resultados tabulares y listados filtrados.
- Vista imprimible o exportable a PDF para dashboards ejecutivos.
- Nombre de archivo con pantalla y fecha del snapshot.
- Inclusión de filtros aplicados y cantidad de registros.
- Codificación compatible con Excel y caracteres en español.

### Ejemplo

```text
nexus_fieldbeat_reportes_2026-07-20.csv
nexus_auditoria_repuestos_sin_match_2026-07-20.csv
```

## 6.4 Fecha de actualización

Todas las pantallas deben mostrar una referencia coherente:

```text
Datos actualizados al: DD/MM/AAAA HH:mm CLT
```

La fecha debe provenir del estado de sincronización o metadata del snapshot, no del reloj del navegador.

## 6.5 Estados del sistema

Cada pantalla debe cubrir:

- carga;
- éxito;
- vacío real;
- error de red;
- error de contrato;
- sesión vencida;
- sin permiso;
- reintento.

# 7. Arquitectura oficial NEXUS v2

## 7.1 Vista general

```text
FUENTES OPERACIONALES
Zendesk · FieldBeat · Dolibarr · Contratos
              │
              ▼
PIPELINE LOCAL NODE.JS
RAW → PROCESSED → MARTS → GOLD
              │
              ▼
WAREHOUSE DE DESARROLLO
DuckDB + PostgreSQL local
              │
     validación y promoción
              ▼
SUPABASE POSTGRES
Snapshot productivo procesado
              │
              ▼
NEXT.JS EN NETLIFY
APIs server-side + UI autenticada
              │
              ▼
GERENCIA Y ADMINISTRACIÓN
Dashboards · Auditoría · Explorador · Búsqueda · Descargas
```

## 7.2 Capa RAW

- conserva respuestas originales por fuente;
- no se expone a usuarios;
- permanece fuera de Git;
- sirve para reproducibilidad y auditoría técnica;
- no se cargará a Supabase para la demo salvo necesidad justificada.

## 7.3 Capa PROCESSED

- deduplicación;
- tipos consistentes;
- fechas normalizadas;
- nombres y códigos estables;
- una tabla por entidad de origen.

## 7.4 Capa MARTS

- relaciones entre sistemas;
- puentes ticket ↔ tarea;
- repuestos ↔ catálogo;
- contratos ↔ cliente/equipo;
- working-hours;
- vistas de detalle y agregaciones intermedias.

## 7.5 Capa GOLD

- métricas y datasets listos para consumo;
- estados de calidad;
- agregaciones de dashboards;
- metadatos de alcance;
- no debe exponerse con su nombre técnico en la UI.

## 7.6 Serving PostgreSQL

Supabase aloja una copia controlada de las capas necesarias para la aplicación. La app accede por funciones server-side mediante un rol de solo lectura para los schemas analíticos.

Para runtime serverless se utilizará el pooler transaccional de Supabase. Las conexiones directas quedarán reservadas para migraciones y validaciones ejecutadas desde local.

## 7.7 Next.js y Netlify

- Next.js App Router sirve páginas y route handlers.
- Netlify despliega desde `main`.
- Las variables sensibles se configuran en la plataforma, no en Git.
- Las APIs se ejecutan en runtime Node.js.
- Los deploy previews pueden usarse para validar `Frontend-Rev`, pero no sustituyen la revisión local.

# 8. Integración NEXUS + CERBERUS reducido

## 8.1 Definición

NEXUS aporta integración y trazabilidad. CERBERUS aporta evaluación de calidad. En v2 ambos se presentan como un solo producto.

```text
NEXUS
relaciona fuentes, entidades y eventos
        +
CERBERUS CORE
explica calidad, ambigüedad y revisión necesaria
        =
NEXUS ENRIQUECIDO
información operacional + nivel de confianza + causas
```

## 8.2 Capacidades incluidas

- estado de calidad por reporte;
- presencia o ausencia de repuestos;
- matching identificado, placeholder, sin match o ambiguo;
- ticket accesible, faltante/restringido o no informado;
- indicadores de consistencia;
- reason codes legibles;
- severidad para auditoría;
- explicación del problema;
- conteos reconciliables.

## 8.3 Evolución posterior

Después de la demo se evaluará una puntuación formal por dimensiones:

- completitud;
- consistencia temporal;
- cliente y equipo;
- técnico y tipo de tarea;
- repuestos;
- evidencia y ticket.

La puntuación no se publicará hasta contar con reglas, ponderaciones, pruebas y validación de negocio.

# 9. Datos y alcance analítico

## 9.1 Snapshot actual de referencia

La evidencia disponible al cierre de las etapas recientes incluye, entre otros:

| Métrica | Valor de referencia |
|---|---:|
| Reportes / tareas FieldBeat | 3.747 |
| Reportes sin ticket informado | 2.537 |
| Reportes vinculados a ticket accesible | 290 |
| Reportes vinculados a ticket faltante o restringido | 920 |
| Reportes con repuestos | 1.809 |
| Repuestos utilizados | 2.193 |
| Repuestos identificados contra catálogo | 927 |
| Reportes OK según calidad actual | 480 |

Estos valores son evidencia de la capacidad del pipeline y no deben hardcodearse en el frontend. La demo los obtiene de Supabase a través de las APIs.

## 9.2 Restricción Zendesk

El universo Zendesk accesible depende de las credenciales actuales. Existen IDs referenciados por FieldBeat que pueden ser inexistentes, estar mal formateados o devolver 403 por permisos. La aplicación debe distinguir:

- ticket accesible;
- ticket referenciado pero faltante o restringido;
- sin ticket informado.

No se debe confundir una restricción de acceso con un defecto del pipeline.

## 9.3 Contratos

La visualización de contratos se incorpora como objetivo P1:

- cliente;
- vigencia;
- equipos cubiertos;
- horario contractual;
- excepciones o feriados aplicables;
- fuente y versión de la regla.

Solo se publicará cuando el modelo contractual actual esté validado para interpretación de negocio. Si no alcanza el gate, la entidad “Contratos” no aparecerá en producción y continuará en desarrollo local.

# 10. Seguridad, autenticación y autorización

## 10.1 Principios

- ningún dashboard queda público;
- no existe auto-registro;
- no se envían secretos al navegador;
- no se expone la contraseña de PostgreSQL;
- la conexión de runtime utiliza un rol de mínimo privilegio;
- los schemas analíticos no se exponen por PostgREST;
- las APIs administrativas no se conectan a controles visibles de la demo;
- las credenciales se pueden rotar.

## 10.2 Autenticación

La recomendación para la demo es Supabase Auth con contraseña y sesión basada en cookies seguras.

Flujo:

```text
ID + contraseña
      ↓
Resolución de identidad preaprovisionada
      ↓
Supabase Auth
      ↓
Cookie HttpOnly + Secure + SameSite
      ↓
Perfil y rol de aplicación
      ↓
Acceso a rutas protegidas
```

## 10.3 Autorización

Las páginas y APIs deben validar sesión y rol en servidor. Ocultar un enlace no constituye autorización.

## 10.4 Medidas mínimas

- contraseñas robustas y únicas;
- rotación después de la demostración inicial si fueron compartidas presencialmente;
- cierre de sesión;
- expiración de sesión;
- protección contra intentos repetidos;
- registro de accesos básico;
- redirección a login ante sesión inválida;
- `service_role` o secret key solo en servidor cuando sea imprescindible;
- ningún secreto con prefijo público.

# 11. Entornos, ramas y control de releases

## 11.1 Producción

| Elemento | Definición |
|---|---|
| Rama | `main` |
| Hosting | Netlify |
| Base | Supabase Postgres |
| Datos | Snapshot validado y congelado |
| Usuarios | Gerencia y Administración |
| Operación | Solo lectura |
| Deploy | Manualmente promovido después de gates |

## 11.2 Desarrollo

| Elemento | Definición |
|---|---|
| Rama | `Frontend-Rev` |
| Ejecución | Local |
| Base | DuckDB + PostgreSQL local desechable |
| Datos | Copias de trabajo y regeneraciones |
| Uso | Nuevas funciones, refactors y pruebas |
| Restricción | No apuntar a la base productiva durante desarrollo |

## 11.3 Promoción

1. Desarrollo y pruebas en `Frontend-Rev`.
2. Code review del diff.
3. Certificación local.
4. Deploy preview opcional.
5. Merge controlado a `main`.
6. Deploy productivo en Netlify.
7. Smoke test post-deploy.
8. Tag de release, por ejemplo `v0.9.0-demo`.

## 11.4 Rollback

- restaurar el deploy anterior desde Netlify;
- no ejecutar migraciones destructivas durante la ventana de demo;
- conservar evidencia del snapshot migrado;
- mantener validación de conteos y schemas;
- documentar la versión de app y datos en cada release.

# 12. Estrategia de actualización de datos

## 12.1 Demo

- snapshot fijo preparado por el responsable técnico;
- no hay botón de actualización de fuentes;
- fecha de datos visible;
- cambios en local no alteran producción;
- la aplicación no almacena credenciales de Zendesk, FieldBeat o Dolibarr en el cliente.

## 12.2 Futuro

Se evaluarán dos mecanismos:

1. Actualización programada cada X horas.
2. Acción administrativa segura “Actualizar fuentes”, que ejecute el pipeline y publique solo después de validación.

La actualización futura debe incluir:

```text
extraer → normalizar → cruzar → validar → construir GOLD
→ sincronizar staging → reconciliar → promover snapshot
```

Nunca debe reemplazarse un snapshot sano por una carga incompleta.

# 13. Priorización reorganizada

## Prioridad 1 — Completar visualizaciones de mockups

### 1A. Auditoría

- reproducir la composición aprobada;
- conectar datos existentes;
- mantener modo lectura;
- filtros, detalle y descarga;
- vocabulario no técnico;
- cero acciones falsas.

### 1B. Explorador

- convertir el explorador técnico en explorador de negocio;
- selector de entidades;
- tarjetas y tabla opcional;
- filtros, búsqueda, detalle y relaciones;
- descarga;
- ocultar schemas y capas técnicas.

**Criterio de término:** ambas pantallas son visualmente coherentes con los mockups y utilizables por una persona que desconoce la arquitectura.

## Prioridad 2 — Cierre de contenido visible

- eliminar “Información todavía no disponible” de producción;
- completar KPI simples de FieldBeat;
- ocultar cruces o tablas no terminados;
- verificar que todos los botones visibles funcionen;
- activar descargas reales;
- revisar texto y unidades.

## Prioridad 3 — Login y roles

- `/login`;
- cuentas Gerencia y Administración;
- middleware y validación server-side;
- cierre de sesión;
- rutas protegidas;
- pruebas de acceso.

## Prioridad 4 — Preparación de datos productivos

- construir DuckDB validado;
- ejecutar DDL Supabase;
- migrar processed/marts/gold necesarios;
- validar filas, columnas y tipos;
- registrar timestamp de snapshot;
- asegurar rol runtime de solo lectura.

## Prioridad 5 — Deploy Netlify

- verificar que la cuenta siga siendo cardless para el uso previsto;
- configurar variables;
- build productivo;
- smoke test;
- URL estable;
- credenciales entregadas.

## Prioridad 6 — Certificación humana

- recorrido completo con Gerencia;
- recorrido completo con Administración;
- escritorio y móvil;
- consola y red;
- filtros;
- descargas;
- sesión;
- entendimiento del vocabulario.

## Prioridad 7 — Continuidad local

- endpoints FieldBeat faltantes;
- contratos en Explorador;
- núcleo analítico compartido;
- CERBERUS formal;
- auditoría con correcciones;
- automatización del pipeline;
- Administración.

# 14. Plan de ejecución de cierre

## 14.1 Límite

**Fecha máxima:** martes 21 de julio de 2026, 15:00 CLT.

## 14.2 Secuencia de trabajo

| Bloque | Entregable | Gate |
|---|---|---|
| A | Auditoría nueva | Visual + datos + lectura |
| B | Explorador de negocio | Entidades + filtros + detalle |
| C | Hardening de demo | Sin placeholders ni botones falsos |
| D | Login y roles | Rutas protegidas |
| E | Snapshot Supabase | Validación PASSED |
| F | Deploy Netlify | Build y rutas 200 |
| G | Certificación | Checklist completo |
| H | Handoff | URL, credenciales y guía breve |

## 14.3 Regla de corte

Cuando una capacidad P1 amenace el plazo:

- no se entrega a medias;
- se oculta de producción;
- se documenta en backlog;
- se mantiene en `Frontend-Rev`;
- no se comprometen los P0.

## 14.4 Congelamiento

Desde el inicio del bloque E:

- no se realizan refactors arquitectónicos;
- no se cambian reglas de negocio sin defecto confirmado;
- no se agregan dependencias por conveniencia;
- no se modifican datos productivos manualmente;
- solo se aceptan correcciones bloqueantes.

# 15. Requisitos funcionales

## 15.1 Autenticación

| ID | Requisito | Prioridad | Aceptación |
|---|---|---:|---|
| RF-AUTH-01 | Login con ID y contraseña | P0 | Credenciales válidas crean sesión; inválidas muestran error sin revelar detalles |
| RF-AUTH-02 | Dos usuarios precreados | P0 | Gerencia y Administración ingresan por separado |
| RF-AUTH-03 | Protección de rutas | P0 | Acceso sin sesión redirige a `/login` |
| RF-AUTH-04 | Cierre de sesión | P0 | Invalida sesión y vuelve a login |
| RF-AUTH-05 | Rol disponible en servidor | P0 | La app identifica el rol sin confiar en datos editables del cliente |

## 15.2 Navegación

| ID | Requisito | Prioridad | Aceptación |
|---|---|---:|---|
| RF-NAV-01 | Sidebar coherente | P0 | Todas las pantallas obligatorias son accesibles |
| RF-NAV-02 | Ruta activa visible | P0 | Usuario reconoce dónde se encuentra |
| RF-NAV-03 | Sin enlaces muertos | P0 | Cero 404 desde navegación principal |
| RF-NAV-04 | Etiquetas de negocio | P0 | No aparecen capas técnicas en el menú |

## 15.3 Consulta y exploración

| ID | Requisito | Prioridad | Aceptación |
|---|---|---:|---|
| RF-EXP-01 | Selector de entidad | P0 | Permite elegir reportes, tickets, repuestos, clientes, equipos y técnicos |
| RF-EXP-02 | Vista tarjetas / tabla | P0 | Usuario alterna sin perder filtros |
| RF-EXP-03 | Filtros | P0 | Modifican el resultado y muestran conteo |
| RF-EXP-04 | Paginación | P0 | No carga universos completos al cliente |
| RF-EXP-05 | Detalle | P0 | Registro abre ficha legible |
| RF-EXP-06 | Relaciones | P1 | Ficha enlaza entidades relacionadas cuando existen |
| RF-EXP-07 | Contratos | P1 | Entidad visible solo con dataset validado |

## 15.4 Auditoría

| ID | Requisito | Prioridad | Aceptación |
|---|---|---:|---|
| RF-AUD-01 | Resumen de incidencias | P0 | Totales reconciliables con API |
| RF-AUD-02 | Categorías legibles | P0 | Sin códigos internos como única explicación |
| RF-AUD-03 | Filtros y detalle | P0 | Permite encontrar registros afectados |
| RF-AUD-04 | Descarga | P0 | Exporta el conjunto filtrado |
| RF-AUD-05 | Solo lectura | P0 | No existe mutación desde UI |
| RF-AUD-06 | Causa y evidencia | P0 | El detalle explica por qué fue marcado |

## 15.5 Descargas

| ID | Requisito | Prioridad | Aceptación |
|---|---|---:|---|
| RF-EX-01 | CSV | P0 | Archivo abre correctamente y contiene filtros aplicados |
| RF-EX-02 | Vista imprimible | P0 | Dashboards pueden guardarse como PDF sin sidebar innecesario |
| RF-EX-03 | Datos actuales | P0 | Exportación coincide con el estado filtrado |
| RF-EX-04 | Seguridad | P0 | No exporta campos técnicos o secretos |

# 16. Requisitos no funcionales

## 16.1 Usabilidad

- una persona sin conocimientos de TI debe comprender el propósito de cada pantalla;
- los números incluyen unidad y contexto;
- los estados de calidad tienen etiquetas humanas;
- los detalles no abruman con campos irrelevantes;
- se usa revelado progresivo: resumen primero, detalle después.

## 16.2 Rendimiento

Metas de demo:

- primera respuesta visual útil en menos de 3 segundos bajo conectividad normal;
- filtros comunes en menos de 2 segundos;
- paginación server-side;
- ningún endpoint descarga miles de filas sin límite;
- exportaciones grandes se limitan o advierten.

## 16.3 Confiabilidad

- build reproducible;
- consultas parametrizadas;
- contratos de respuesta validados;
- estados de error visibles;
- conteos reconciliados;
- snapshot identificable;
- rollback disponible.

## 16.4 Accesibilidad

- navegación por teclado;
- foco visible;
- contraste suficiente;
- tablas semánticas;
- botones reales para acciones reales;
- barras decorativas ocultas a lectores;
- mensajes dinámicos anunciados cuando corresponda.

## 16.5 Mantenibilidad

- separar contratos, lógica, estado y presentación;
- no duplicar lógica analítica entre dashboards cuando exista un seam real;
- no refactorizar por anticipación antes de la demo;
- tests para parsers, métricas, filtros e invariantes;
- decisiones arquitectónicas registradas.

# 17. Calidad y estrategia de pruebas

## 17.1 Baseline actual

Las etapas recientes reportaron:

- typecheck sin errores;
- cientos de pruebas unitarias;
- pruebas de integración PostgreSQL;
- builds exitosos;
- smoke tests;
- reconciliación exacta de FieldBeat;
- validaciones de working-hours;
- code review formal.

## 17.2 Gate automatizado de release

Antes de desplegar:

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
npm run smoke
git diff --check
```

## 17.3 Gate manual

- login Gerencia;
- login Administración;
- navegación completa;
- filtros;
- detalle;
- descarga;
- cierre de sesión;
- escritorio 1440/1280;
- tablet 768;
- móvil 390;
- consola sin errores;
- red sin 404/500;
- cero placeholders visibles;
- textos comprensibles.

## 17.4 Protocolo de desarrollo asistido

Para cambios de prioridad 1 se exige consultar y aplicar, cuando estén disponibles:

- `research`;
- `codebase-design`;
- `systematic-debugging`;
- `test-driven-development`;
- `eyg-nexus-local:code-review`.

El reporte de cada etapa debe registrar qué skill fue cargada y qué decisión produjo. Ningún reporte puede atribuir una skill no consultada.

# 18. Criterios de aceptación de la demo

## Gate A — Producto

- [ ] Login operativo.
- [ ] Inicio usable.
- [ ] Operacional usable.
- [ ] FieldBeat sin bloques incompletos visibles.
- [ ] After-Hours usable.
- [ ] Auditoría nueva usable.
- [ ] Explorador de negocio usable.
- [ ] Búsqueda usable.
- [ ] Descargas reales.

## Gate B — Datos

- [ ] Snapshot real procesado.
- [ ] `validation_status = PASSED`.
- [ ] Fecha de actualización visible.
- [ ] Conteos principales reconciliados.
- [ ] No se cargó RAW innecesario.
- [ ] Restricciones de alcance visibles donde corresponda.

## Gate C — Seguridad

- [ ] Todas las rutas de producto requieren sesión.
- [ ] No hay auto-registro.
- [ ] No hay secretos en navegador o repositorio.
- [ ] Runtime usa rol de solo lectura.
- [ ] Schemas internos no están expuestos.
- [ ] Acciones administrativas no están accesibles desde UI.

## Gate D — Despliegue

- [ ] Netlify no exigió tarjeta para el flujo aprobado.
- [ ] Variables configuradas en plataforma.
- [ ] Build verde.
- [ ] Smoke de producción verde.
- [ ] Rollback identificado.
- [ ] `main` coincide con el release desplegado.

## Gate E — Experiencia

- [ ] Gerencia comprende las pantallas sin explicación técnica extensa.
- [ ] Administración encuentra un registro objetivo.
- [ ] No aparecen nombres de schemas o tablas.
- [ ] No hay botones sin acción.
- [ ] No hay “Información todavía no disponible”.
- [ ] No hay overflow o texto ilegible.

# 19. Riesgos y mitigaciones

| ID | Riesgo | Prob. | Impacto | Mitigación |
|---|---|:---:|:---:|---|
| R-01 | Plazo extremadamente corto | Alta | Alto | P0 estrictos, ocultar P1 incompleto, congelar refactors |
| R-02 | Auditoría y Explorador exceden el esfuerzo | Media | Alto | Reusar contratos existentes; limitar a lectura, filtros, detalle y descarga |
| R-03 | FieldBeat conserva placeholders | Alta | Alto | Completar métricas simples o feature flag de producción |
| R-04 | Login introduce regresiones | Media | Alto | Implementar antes del deploy final; pruebas de middleware y sesión |
| R-05 | Netlify solicita billing | Media | Alto | Gate cardless temprano; no registrar tarjeta; documentar bloqueo y activar alternativa aprobada solo mediante decisión |
| R-06 | Supabase o pooler mal configurado | Media | Alto | Runbook, pooler transaccional, smoke y validación directa |
| R-07 | Exposición de datos reales | Baja/Media | Crítico | Login, server-side, rol read-only, schemas no expuestos, secrets seguros |
| R-08 | Datos de Zendesk incompletos por 403 | Alta | Medio | Mostrar alcance y separar restringido de inexistente |
| R-09 | Snapshot queda obsoleto | Alta | Medio | Timestamp visible y comunicación de snapshot fijo |
| R-10 | Producción se rompe por desarrollo posterior | Media | Alto | `main` estable, `Frontend-Rev` local, promoción controlada |
| R-11 | Gerencia interpreta un indicador sin contexto | Media | Alto | Lenguaje de negocio, subtítulos, tooltips y definiciones |
| R-12 | Exportación filtra campos internos | Baja | Alto | Whitelist de columnas y tests de contrato |

# 20. Decisiones arquitectónicas registradas

| ID | Decisión | Justificación |
|---|---|---|
| DA-01 | Supabase + Netlify | Compatibilidad con arquitectura actual y restricción cardless |
| DA-02 | Snapshot fijo para demo | Reduce riesgo operacional y permite certificar números |
| DA-03 | Producción de solo lectura | Seguridad y alcance; no existe aún ciclo de gobernanza completo |
| DA-04 | `main` producción / `Frontend-Rev` desarrollo | Separa estabilidad de evolución |
| DA-05 | Supabase Auth para identidad | Evita construir almacenamiento de contraseñas propio bajo presión |
| DA-06 | CERBERUS absorbido en NEXUS | Entrega valor de calidad sin sostener dos productos paralelos |
| DA-07 | Explorador orientado a negocio | La audiencia no debe conocer capas de datos |
| DA-08 | No mostrar capacidades incompletas | Protege credibilidad de la demo |
| DA-09 | Pooler transaccional en runtime | Adecuado para funciones serverless de corta duración |
| DA-10 | RAW permanece local | Minimiza exposición y consumo de espacio en demo |

# 21. Backlog posterior a la demo

## NEXUS v1.1 — Primer ciclo local

- completar todos los endpoints de FieldBeat;
- mostrar contratos validados;
- núcleo compartido de filtros, periodos y paginación;
- mejorar detalle relacional;
- cuentas personales;
- roles adicionales;
- observabilidad y métricas de uso;
- automatizar promoción de snapshots.

## NEXUS v1.2 — Gobernanza

- corrección de aliases;
- overrides de tickets;
- resolución de auditorías;
- usuario, fecha y justificación;
- reprocesamiento;
- historial de cambios;
- Administración.

## NEXUS v2 — Calidad y operación ampliadas

- CERBERUS formal por dimensiones;
- score de calidad validado;
- priorización avanzada;
- actualizaciones programadas;
- botón seguro de refresh;
- stock y movimientos;
- mayor cobertura contractual;
- preparación para JANUS / ATLAS.

# 22. Entregables de la liberación

1. Aplicación desplegada en Netlify.
2. Base Supabase con snapshot validado.
3. Dos cuentas de acceso.
4. Release en `main` con tag.
5. Checklist de aceptación firmado por el responsable técnico.
6. Registro de fecha de datos.
7. Guía de uso de una página para Gerencia y Administración.
8. Registro de limitaciones conocidas.
9. Plan de rollback.
10. Backlog local priorizado.

# 23. Guía de presentación a Gerencia y Administración

La demostración debe centrarse en preguntas, no en tecnología.

## Recorrido recomendado

1. **Inicio:** qué puede responder NEXUS.
2. **Operacional:** visión consolidada del servicio.
3. **FieldBeat:** actividad de terreno y repuestos.
4. **Fuera de horario:** evidencia temporal y contractual.
5. **Auditoría:** dónde faltan datos o hay ambigüedad.
6. **Explorador:** encontrar un cliente, equipo o reporte.
7. **Búsqueda:** localizar rápidamente una entidad.
8. **Descarga:** llevar un resultado a análisis externo.

## Mensaje central

> NEXUS no reemplaza los sistemas de origen. Los conecta, depura y explica para convertir registros operacionales dispersos en información que puede consultarse y auditarse.

## Mensajes que deben evitarse

- detalles de schemas;
- SQL;
- Docker;
- branches;
- DuckDB;
- diferencias entre MARTS y GOLD;
- limitaciones presentadas como excusas técnicas.

# 24. Glosario ejecutivo

| Término | Definición |
|---|---|
| NEXUS | Plataforma que integra y relaciona información operacional de varias fuentes |
| CERBERUS Core | Capacidades de calidad y auditoría integradas dentro de NEXUS |
| Reporte de terreno | Registro de trabajo ejecutado en FieldBeat |
| Ticket de soporte | Solicitud o incidente registrado en Zendesk |
| Repuesto identificado | Repuesto vinculado de forma confiable al catálogo Dolibarr |
| Placeholder | Valor genérico que no identifica un repuesto real |
| Sin match | Valor que no pudo asociarse al catálogo con las reglas actuales |
| Ambiguo | Valor que puede corresponder a más de un producto |
| Snapshot | Copia fija y validada de datos utilizada por la demo |
| Auditoría | Vista que explica problemas, faltantes y registros que requieren revisión |
| Explorador | Herramienta para navegar entidades de negocio y sus relaciones |
| Producción demo controlada | Entorno estable y autenticado, de solo lectura, con datos reales procesados |
| Feature flag | Configuración que permite ocultar una capacidad no terminada sin borrar su desarrollo |

# 25. Conclusión

NEXUS se encuentra técnicamente sano y suficientemente avanzado para liberar una demostración productiva controlada. La plataforma ya posee una base de datos integrada, reglas de procesamiento, dashboards, APIs y pruebas que superan la naturaleza experimental del levantamiento original.

El riesgo principal no es la viabilidad técnica. Es la dispersión de prioridades y la posibilidad de mostrar capacidades incompletas antes de cerrar una experiencia coherente. Por esa razón, la baseline v2 establece una secuencia estricta: terminar Auditoría y Explorador, cerrar bloqueadores de demo, autenticar, desplegar un snapshot real y congelar producción mientras el desarrollo continúa en local.

El criterio de éxito no será la cantidad de módulos técnicos implementados, sino que Gerencia y Administración puedan entrar, comprender, navegar, buscar, explorar, abrir detalles y descargar resultados sin asistencia técnica constante.

La demo se considerará liberada cuando cumpla todos los P0 y los gates de producto, datos, seguridad, despliegue y experiencia. Las mejoras profundas —CERBERUS formal, gobernanza escribible, automatización y administración— continuarán en `Frontend-Rev` y se promoverán únicamente después de validación.

<div class="verdict">

**BASELINE OFICIAL NEXUS v2.0**

- Prioridad inmediata: Auditoría + Explorador.
- Fecha límite: martes 21 de julio de 2026, 15:00 CLT.
- Producción: `main` + Netlify + Supabase.
- Desarrollo: `Frontend-Rev` + entorno local.
- Datos: reales, procesados, snapshot fijo y trazable.
- Acceso: Gerencia y Administración mediante ID y contraseña.
- Operación: lectura, filtros, búsqueda, exploración, detalle y descarga.
- CERBERUS: reducido e integrado en NEXUS.

</div>

# Anexo A — Checklist operativo de liberación

## Código

- [ ] `git status` revisado.
- [ ] Diff limitado al alcance.
- [ ] Endpoint y contratos revisados.
- [ ] Sin dependencias innecesarias.
- [ ] Sin secretos versionados.
- [ ] `package-lock.json` solo cambia cuando es necesario y justificado.

## Validación

- [ ] Typecheck.
- [ ] Tests unitarios.
- [ ] Integración.
- [ ] Build.
- [ ] Smoke.
- [ ] `git diff --check`.
- [ ] Navegador real.
- [ ] Responsive.
- [ ] Accesibilidad básica.

## Datos

- [ ] Pipeline ejecutado.
- [ ] Warehouse construido.
- [ ] DDL actualizado.
- [ ] Migración a Supabase.
- [ ] Validación PASSED.
- [ ] Conteos comparados.
- [ ] Timestamp visible.

## Seguridad

- [ ] Usuarios creados.
- [ ] Contraseñas entregadas por canal seguro.
- [ ] Registro público deshabilitado.
- [ ] Rutas protegidas.
- [ ] Runtime read-only.
- [ ] Schemas no expuestos.
- [ ] Secrets solo server-side.

## Despliegue

- [ ] Netlify cardless confirmado.
- [ ] Variables configuradas.
- [ ] Build logs revisados.
- [ ] URL productiva.
- [ ] Smoke remoto.
- [ ] Rollback conocido.
- [ ] Tag de release.

## Handoff

- [ ] Gerencia ingresa.
- [ ] Administración ingresa.
- [ ] Recorrido ejecutado.
- [ ] Guía breve entregada.
- [ ] Limitaciones explicadas.
- [ ] Canal de reporte de errores definido.

# Anexo B — Fuentes documentales

## Fuentes internas

1. Levantamiento Maestro NEXUS + CERBERUS Fase 1, 30 de junio de 2026.
2. `docs/ARCHITECTURE.md`.
3. `docs/DATA_PIPELINE.md`.
4. `docs/GOLD_DATA_CONTRACT.md`.
5. `docs/SCOPE_AND_LIMITATIONS.md`.
6. `docs/RUNBOOK_SUPABASE_NETLIFY.md`.
7. `docs/design-context/**`.
8. `docs/design-revolution/Nexus - Auditoria.dc.html`.
9. `docs/design-revolution/Nexus - Explorador.dc.html`.
10. Reportes finales de implementación After-Hours y FieldBeat.

## Referencias técnicas oficiales consultadas

- Netlify Docs, “Next.js on Netlify”: https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
- Netlify Docs, “Environment variables and serverless functions”: https://docs.netlify.com/build/functions/environment-variables/
- Supabase Docs, “Auth”: https://supabase.com/docs/guides/auth
- Supabase Docs, “Password-based Auth”: https://supabase.com/docs/guides/auth/passwords
- Supabase Docs, “Row Level Security”: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Docs, “Connect to your database”: https://supabase.com/docs/guides/database/connecting-to-postgres

**Fecha de consulta:** 20 de julio de 2026.
