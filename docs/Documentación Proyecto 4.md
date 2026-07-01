## 

## 

## 

# Actualización de documentación del Proyecto 4: 

# Script de Sincronización General

# Fieldbeat \- Dolibarr 

**Rediseño Arquitectural (***SSoT***)**: Optimización de Diseño, Integridad de Datos, Estabilidad Operativa y Arreglo de Bugs de Funcionalidad Críticos  
**(Versión 19.01.2026)**

[1\. Resumen General	2](#1.-resumen-general)

[2\. Requisitos Previos	4](#2.-requisitos-previos)

[3\. Configuración General (Constantes Globales)	5](#3.-configuración-general-\(constantes-globales\))

[4\. Funcionamiento Detallado Renovado (Mejoras en Arquitectura)	5](#4.-funcionamiento-detallado-renovado-\(mejoras-en-arquitectura\))

[4.1. Ingesta y Filtrado (The Gatekeeper)	5](#4.1.-ingesta-y-filtrado-\(the-gatekeeper\))

[4.2. Resolución Inteligente de Repuestos	6](#4.2.-resolución-inteligente-de-repuestos)

[4.3. Estrategia de Asignación de Bodega	6](#4.3.-estrategia-de-asignación-de-bodega)

[Rama A: Bodegas Internas (Cluster E\&G)	6](#rama-a:-bodegas-internas-\(cluster-e&g\))

[Rama B: Bodegas de Cliente (Externas)	6](#rama-b:-bodegas-de-cliente-\(externas\))

[4.4. Transacción y Cierre	7](#4.4.-transacción-y-cierre)

[5\. Componentes Principales (Funciones Clave)	7](#5.-componentes-principales-\(funciones-clave\))

[mainProcess()	7](#mainprocess\(\))

[processSingleRepuestoGroup(group, taskId, clientName)	7](#processsinglerepuestogroup\(group,-taskid,-clientname\))

[handleBodegaEG(...)	7](#handlebodegaeg\(...\))

[handleBodegaCliente(...)	8](#handlebodegacliente\(...\))

[loadDictionaryMap()	8](#loaddictionarymap\(\))

[normalizeStockResponse(stockInfo)	8](#normalizestockresponse\(stockinfo\))

[Funciones API y Helpers (getDolibarrProductIdBySku, etc.)	8](#funciones-api-y-helpers-\(getdolibarrproductidbysku,-etc.\))

[6\. Manejo de Errores y Registros (Logging)	9](#6.-manejo-de-errores-y-registros-\(logging\))

[**7\. Protocolos de Corrección y Auditoría de Datos (Data Governance)	9**](#8.-protocolos-de-corrección-y-auditoría-de-datos-\(data-governance\))

[7.1. Scripts de Saneamiento Masivo (Fix Patches)	9](#heading=)

[7.2. Intervención Manual Directa	9](#heading=)

[8\. Disparador (Trigger)	10](#9.-disparador-\(trigger\))

[9\. Flujo de Datos por Registro	11](#10.-flujo-de-datos-por-registro)

[**10\. Control de Cambios y Evolución Arquitectónica (v2025.12 vs v2026.01.19)	12**](#11.-control-de-cambios-y-evolución-arquitectónica-\(v2025.12-vs-v2026.01.19\))

[10.1. Matriz Comparativa de Funcionalidades	12](#heading=)

[10.2. Detalle de Mejoras Críticas	13](#heading=)

[A. Implementación de "Single Source of Truth"	13](#heading=)

[B. Algoritmo de Búsqueda Greedy Optimizado	13](#heading=)

[C. Saneamiento de Logs Históricos	13](#c.-saneamiento-de-logs-históricos)

# 

# **1\. Resumen General** {#1.-resumen-general}

Este script actúa como el Orquestador Principal de la sincronización de inventario entre Fieldbeat (Gestión de Servicios de Campo) y Dolibarr (ERP). Su función primordial es monitorear continuamente la generación de reportes de tareas. Al detectar un nuevo reporte, el script analiza el contenido, **identifica todos los grupos de repuestos utilizados** y realiza los movimientos de stock correspondientes en Dolibarr de forma individual por cada ítem.

En esta versión se consideran 2 puntos principales:

1. **Evolución Arquitectónica (Versión Enero 2026):**

Esta versión implementa una arquitectura mejorada con un patrón de "**Única Fuente de Verdad**" (Single Source of Truth). A diferencia de las versiones anteriores estáticas, este sistema combina la velocidad de un Caché en Memoria (implementando la estructura de datos Hash Map) para la lógica de agrupación con consultas dinámicas a la API para la resolución de nombres técnicos. Esto elimina el hardcoding de nombres de bodegas y permite una escalabilidad automática ante posibles cambios en la topología de las bodegas del ERP Dolibarr a futuro.

2. **Alcance Operativo (se mantiene funcionalidad versión anterior):**

El script procesa todas las tareas estándar de la organización, excluyendo explícitamente aquellas pertenecientes al proyecto "Apoteca \- FALP". Estas son detectadas y filtradas para ser gestionadas por un micro-servicio dedicado (Proyecto 5), garantizando la segregación de inventarios críticos.  
**Diferenciación y Convivencia de Sistemas:**  
La versión de este script mantiene la **Lógica de Filtrado de Exclusión** para el proyecto "Apoteca \- FALP":

* **Si es tarea "Apoteca":** El script detecta palabras clave en el cliente, descripción, reporte o equipos. Si hay coincidencia, ignora la tarea y deja el correo **sin leer**, permitiendo que otro script dedicado (Proyecto 5\) la procese.  
* **Si es tarea Estándar:** El script procesa la tarea. A diferencia de versiones anteriores, este código está optimizado para manejar **múltiples líneas de repuestos** en un solo reporte.

**Características Principales:**

* **Procesamiento Multi-Grupo:** Capacidad de leer múltiples secciones llamadas "REPUESTOS" dentro de una misma tarea y procesar cada SKU por separado.  
* **Búsqueda de Producto Optimizada:** Ahora usamos una Búsqueda en Cascada (Cascade Search). Primero intentamos exacto, pero si falla, tenemos redes de seguridad (Like y Barcode). Es decir, Esta versión prioriza filtros estrictos (*:=:*) para exactitud, pero incluye mecanismos de respaldo (Búsqueda Tolerante y Código de Barras) para maximizar la tasa de éxito.  
* **Gestión de Bodegas Renovada y Mejorada:**   
  * **Internas**: Búsqueda jerárquica profunda (Hubs \+ Casilleros) con Resolución Dinámica de Nombres (ID API \--\> Diccionario) para reportes legibles.  
  * **Externas**: Mapeo directo mediante Diccionario en memoria (con un Hash Map).

# **2\. Requisitos Previos** {#2.-requisitos-previos}

Para garantizar el funcionamiento ininterrumpido del script, se deben satisfacer los siguientes requisitos técnicos y de configuración:

1. **Google Account:** Una cuenta de Google activa con acceso a Google Apps Script, Gmail y Google Sheets.  
2. **Credenciales de API (Script Properties):**  
   * FIELDBEAT\_API\_USER: Usuario válido para la API de Fieldbeat.  
   * FIELDBEAT\_API\_PASS: Contraseña correspondiente.  
   * DOLIBARR\_API\_KEY: Clave de API de Dolibarr con permisos de lectura y escritura (POST) en los módulos de Productos y Stock.  
   * *Configuración:* Estas deben guardarse en "Propiedades del guión" (Script Properties) dentro del editor de Apps Script para mayor seguridad.  
3. **Hoja de Cálculo de Logs y Configuración:**  
   * Se requiere una hoja de cálculo con el ID: 1AJ4p5pWMVsnZruv8sAUxSi77FcWsjQ\_BEKc8gedyJS8.  
   * **Pestaña 'Registros':** Destinada a almacenar el historial de ejecuciones.  
   * **Pestaña 'Diccionario':** Esencial para el mapeo de bodegas de clientes.  
     * *Columna A:* Nombre lógico o comercial (ej: "Pañol E\&G", "Bodega Clínica Alemana").  
     * *Columna B:* Nombre técnico exacto en Dolibarr (ej: "Casillero 3A3", "Bodega CAS").  
4. **Revisión topológica de Bodegas en Dolibarr:**  
   * Deben existir y estar activos los IDs correspondientes al Cluster E\&G Completo: Hubs Principales (3, 1, 46, 17\) y la red de Casilleros/Sub-ubicaciones (Series 1A a 4B, IDs 23-66). La ausencia de estos IDs generará errores de "Stock Insuficiente".  
5. **Permisos de Ejecución (OAuth):**  
   * Al instalarse, el script solicitará permisos para leer/gestionar correos de Gmail (https://www.googleapis.com/auth/gmail.modify), conectar con servicios externos (UrlFetchApp) y modificar hojas de cálculo.

# 

# **3\. Configuración General (Constantes Globales)** {#3.-configuración-general-(constantes-globales)}

El comportamiento se rige por las siguientes constantes en el código:

* **IDs y Hojas:**  
  * LOG\_SPREADSHEET\_ID: ID del Google Sheet.  
  * LOG\_SHEET\_NAME: 'Registros'.  
  * DICTIONARY\_SHEET\_NAME: 'Diccionario'.  
* **Endpoints y Correos:**  
  * FIELDBEAT\_API\_URL: Endpoint base de tareas (https://api.fieldbeat.com/...).  
  * DOLIBARR\_API\_URL\_BASE: Endpoint base del ERP (http://erm.eygsa.cl/...).  
  * NOTIFICATION\_EMAIL: Lista de correos para alertas de error (ej. datos@eygsa.cl, ...).  
* **Mejora en la Configuración de Topología de Bodegas:**  
  * EG\_FIELDbeat\_WAREHOUSE\_NAMES: Lista de nombres normalizados que el sistema reconoce como "Bodegas Internas" (ej: 'pañol e\&g', 'bodega cas', etc.).  
  * EG\_WAREHOUSE\_IDS\_PRIORITY: Vector Jerárquico Extendido. A diferencia de versiones anteriores, esta lista contiene más de 40 IDs ordenados estratégicamente.  
  * **Orden de Barrido:** Hub Central (ID 3\) → Red de Casilleros y Estantes (IDs 23 al 66\) → Bodegas Satélites (IDs 1, 46, 17\).  
  * **Objetivo:** Maximizar la probabilidad de encontrar stock específico antes de descontar del stock general.

# 

# 

# **4\. Funcionamiento Detallado Renovado (*Mejoras en Arquitectura*)** {#4.-funcionamiento-detallado-renovado-(mejoras-en-arquitectura)}

Se han implementado diversas mejoras en el ciclo de ejecución (*mainProcess*) implementa un flujo de trabajo secuencial enriquecido con patrones de decisión inteligente. A continuación, se detalla el ciclo de vida de una transacción:

### **4.1. Ingesta y Filtrado (The Gatekeeper)** {#4.1.-ingesta-y-filtrado-(the-gatekeeper)}

1. **Polling de Correos:** El script escanea la bandeja de entrada buscando correos no leídos provenientes de noreply@fieldbeat.com con el asunto estandarizado "Reporte de tarea Nº".  
2. **Extracción de Metadatos:** Se aísla el ID de la tarea y se consulta la API de Fieldbeat para obtener el objeto JSON completo (*taskData*).  
3. **Filtro de Exclusión (Semáforo Apoteca):**  
   * El sistema analiza el Cliente, Descripción, Nombre del Reporte y lista de Equipos.  
   * **Condición de Carrera:** Si detecta la combinación de palabras clave "Apoteca" \+ "Arturo Lopez Perez", detiene el procesamiento inmediatamente y deja el correo como **NO LEÍDO**. Esto delega la responsabilidad al micro-servicio del Proyecto 5\.

   ### 

   ### 

   ### **4.2. Resolución Inteligente de Repuestos** {#4.2.-resolución-inteligente-de-repuestos}

Si la tarea supera el filtro anterior, el script itera sobre cada grupo de repuestos (*repuestosGroups*). Para cada ítem, ejecuta la siguiente lógica de identificación sólida:

* **Identificación del Producto (Cascade Search):** A diferencia de una búsqueda simple, el sistema intenta localizar el SKU en Dolibarr mediante tres niveles de profundidad para mitigar errores humanos:  
  1. **Nivel 1 (Exactitud):** Búsqueda por Referencia exacta (:=:).  
  2. **Nivel 2 (Tolerancia):** Búsqueda por coincidencia parcial (LIKE) para manejar espacios accidentales.  
  3. **Nivel 3 (Alternativa):** Búsqueda por Código de Barras / EAN (barcode).

  ### **4.3. Estrategia de Asignación de Bodega** {#4.3.-estrategia-de-asignación-de-bodega}

Una vez identificado el producto, el sistema decide la estrategia de descuento basándose en el origen reportado en Fieldbeat:

#### **Rama A: Bodegas Internas (Cluster E\&G)** {#rama-a:-bodegas-internas-(cluster-e&g)}

Si la bodega reportada está en la lista de internas (ej: "Pañol E\&G"):

1. **Obtención de Inventario Global:** Descarga todo el stock disponible del producto en todas las bodegas.  
2. **Búsqueda Jerárquica (Greedy Search):** Barre la lista de prioridad (EG\_WAREHOUSE\_IDS\_PRIORITY), comenzando por el Hub Central (ID 3\), luego la red de Casilleros (IDs 23-66) y finalmente las bodegas satélite. Selecciona la primera ubicación que cumpla Stock Físico \>= Cantidad Solicitada.  
3. **Resolución Dinámica de Nombres (Dynamic Resolution):**  
   * Una vez hallado el ID técnico (ej: ID 3), el sistema consulta a la API (GET /warehouses/3) para obtener su etiqueta vigente ("Bodega EyG 1"). Esto desacopla el código de los cambios de nombre en el ERP.  
4. **Abstracción de Grupo (Logical Mapping):**  
   * Antes de registrar el éxito, el sistema consulta el 'Diccionario' en memoria. Traduce la ubicación técnica ("Bodega EyG 1" o "Casillero 3A3") al concepto de negocio ("Pañol E\&G"), manteniendo la coherencia en los reportes gerenciales.

   #### **Rama B: Bodegas de Cliente (Externas)** {#rama-b:-bodegas-de-cliente-(externas)}

Si la bodega es externa (ej: "Bodega Clínica Alemana"):

1. **Mapeo Directo:** Utiliza el 'Diccionario' para traducir el nombre de Fieldbeat al nombre exacto de la bodega en Dolibarr.  
2. **Validación:** Confirma que la bodega exista y tenga ID válido antes de proceder.

   ### **4.4. Transacción y Cierre** {#4.4.-transacción-y-cierre}

1. **Ejecución de Movimiento:** Se envía una petición POST al endpoint /stockmovements de Dolibarr con la cantidad negativa calculada (\-Math.abs(cantidad)), garantizando el descuento real.  
2. **Bitácora:** Se registra el resultado en la hoja 'Registros' con el estado "Éxito (Con repuestos)" y el ID de movimiento generado.  
3. **Actualización de correo:** Si no hubo excepciones críticas, se marca el correo como **LEÍDO** para evitar re-procesamientos.

   

 


## **5\. Componentes Principales (Funciones Clave)** {#5.-componentes-principales-(funciones-clave)}

El script está modularizado en funciones especializadas para garantizar la mantenibilidad y la separación de responsabilidades:

### **mainProcess()** {#mainprocess()}

**Rol:** Orquestador Principal.

* Maneja el ciclo de vida de la ejecución: lectura de Gmail, parseo de IDs y control de excepciones.  
* Implementa el **Filtro de Exclusión (Apoteca)** al inicio del proceso.  
* Itera sobre los grupos de repuestos encontrados en el JSON de la tarea y acumula métricas de éxito/fracaso.

### **processSingleRepuestoGroup(group, taskId, clientName)** {#processsinglerepuestogroup(group,-taskid,-clientname)}

**Rol:** Unidad de Procesamiento Individual.

* Analiza un bloque específico de "REPUESTOS" dentro de la tarea.  
* **Extracción:** Obtiene SKU, Cantidad y Nombre de Bodega de los campos personalizados.  
* **Validación:** Asegura que la cantidad sea numérica y mayor a cero (Qty \> 0).  
* **Enrutamiento:** Determina si el flujo debe ir a la rama interna (handleBodegaEG) o externa (handleBodegaCliente) basándose en la lista EG\_FIELDbeat\_WAREHOUSE\_NAMES.

### **handleBodegaEG(...)** {#handlebodegaeg(...)}

**Rol:** Motor Lógico para el Cluster E\&G (Interno).

* **Identificación:** Resuelve el ID del producto mediante búsqueda en cascada.  
* **Normalización:** Invoca a normalizeStockResponse para sanear la respuesta de la API.  
* **Algoritmo de Búsqueda:** Ejecuta el barrido sobre la lista de prioridad extendida (EG\_WAREHOUSE\_IDS\_PRIORITY), revisando Hubs y Casilleros secuencialmente.  
* **Resolución Dinámica:** Una vez hallado el stock, consulta el nombre técnico a la API y el nombre de grupo al Diccionario en caché antes de registrar el éxito.

### 

### 

### **handleBodegaCliente(...)** {#handlebodegacliente(...)}

**Rol:** Motor Lógico para Bodegas Externas.

* Realiza un mapeo directo consultando el Diccionario en memoria para traducir el nombre de Fieldbeat al nombre exacto en Dolibarr.  
* Valida la existencia del ID de bodega y ejecuta el descuento directo.

### **loadDictionaryMap()** {#loaddictionarymap()}

**Rol:** Optimización de Rendimiento.

* Carga la hoja 'Diccionario' completa en una estructura de datos en memoria (Hash Map) al inicio de la ejecución.  
* Permite búsquedas de nombres en tiempo constante O(1), eliminando la latencia de lectura repetitiva a la hoja de cálculo.

### **normalizeStockResponse(stockInfo)** {#normalizestockresponse(stockinfo)}

**Rol:** Integridad de Datos.

* Soluciona el problema de inconsistencia en la API de Dolibarr, donde los IDs de bodega a veces se omiten dentro de los objetos de datos. Esta función inyecta explícitamente el warehouse\_id para garantizar que el algoritmo de búsqueda no falle silenciosamente.

### **Funciones API y Helpers (getDolibarrProductIdBySku, etc.)** {#funciones-api-y-helpers-(getdolibarrproductidbysku,-etc.)}

**Rol:** Interfaz con el ERP.

* **Evolución:** A diferencia de versiones anteriores que usaban solo igualdad estricta, ahora implementan una **Estrategia de Búsqueda en Cascada**:  
  1. t.ref:=:'...' (Exacta)  
  2. t.ref:like:'...' (Tolerante)  
  3. t.barcode:=:'...' (Código de Barras)




# **6\. Manejo de Errores y Registros (Logging)** {#6.-manejo-de-errores-y-registros-(logging)}

El sistema mantiene una bitácora detallada en Google Sheets para auditoría y trazabilidad:

* **Éxito (Con repuestos):** Movimiento realizado correctamente. Incluye el ID de movimiento generado por Dolibarr.  
* **Éxito (Sin Repuestos):** La tarea fue analizada correctamente, pero no contenía consumo de materiales o el grupo de repuestos estaba vacío.  
* **ERROR:** Fallo crítico que impidió el procesamiento (API caída, SKU inexistente, Stock insuficiente en todo el cluster).

**Tipos de Errores Comunes:**

* Cantidad inválida: El técnico ingresó 0 o un valor no numérico.  
* Bodega no está en el Diccionario: El nombre de la bodega cliente en Fieldbeat no tiene coincidencia en la hoja 'Diccionario'.  
* SKU no encontrado: El código de producto no existe en Dolibarr.  
* Stock insuficiente: Solo aplica para bodegas internas si ninguna de las bodegas prioritarias tiene la cantidad requerida.

# 7\. **Resolución de Problemas (Troubleshooting)**

## 7.1: Guía para Operadores, Analistas, Encargados, Revisores de Correo.

* **Perfil**: Trabaja desde el Google Sheet y el Correo.

Esta tabla explica los errores que aparecerán en la hoja "**Registros**" o en las **alertas por email.**

| Mensaje de Error (Hoja/Email) | ¿Qué pasó en el Negocio? | Acción Requerida (Solución) |
| :---- | :---- | :---- |
| **"API Error 404"** | **Recurso No Encontrado.** El sistema intentó buscar un producto o bodega que Dolibarr dice que "no existe". Probablemente el producto fue borrado, desactivado, o simplemente se ingresó mal un valor, **Por ejemplo:** ingresar un SKU que no corresponda con el Repuesto utilizado en el reporte FieldBeat; el repuesto puede existir y se encuentra si se busca por nombre, pero el ID puede ser distinto en la bodega con el que se ingresó en el reporte, en este caso corresponde revisar manualmente si corresponde, para ello contactar al técnico a cargo. | 1\. Copie el SKU que figura en el reporte. 2\. Búsquelo en Dolibarr. 3\. Si no se encuentra, busque el repuesto por nombre, si el repuesto en efecto figura en la bodega correspondiente, **contactar el técnico** para ver si el error fue de ingreso de datos al momento de crear el reporte, o si bien, el SKU del repuesto está mal asignado en el Dolibarr. De ser el caso, contactar con el **encargado de bodega** para realizar las gestiones correspondientes. 4\. Si existe, verifique si su ID interno cambió, recordar que el script sigue el orden SKU \> ID Interno \> Semejanza. 5\. Dependiendo del procedimiento, actualizar el SKU en el Google Sheets para no perturbar la trazabilidad de registros, a la para que se indica en la columna “Mensaje de Error” la modificación realizada, siguiendo el formato provisto en la sección anterior de este documento “Manejo de Errores y Registros (Logging)”. |
| **"Bodega \[Nombre\] no está en el Diccionario"** | Fieldbeat reportó una bodega nueva o con nombre mal escrito que no tenemos mapeada en la pestaña “Diccionario” de la hoja de cálculo, considerando **Columna A: FieldBeat** y **Columna B: Dolibarr**. | 1\. Revise qué Bodega fue ingresada 2\. Vaya a la pestaña "Diccionario". 3\. Busque si la bodega reportada existe (teniendo en consideración la posibilidad de haber sido mal escrita). 4\. Si considera que el problema fue un ingreso mal escrito, corregirlo manualmente y hacer la revisión del descuento de Dolibarr. 5\. Si la bodega reportada no existe en el diccionario coordinar con TI para actualizar el Diccionario de manera pertinente. |
| **"SKU \[Código\] no encontrado."**  | Fallaron los 3 métodos de búsqueda (Exacto, Parecido y Barras). El código es totalmente desconocido para el sistema. \*Este error puede ser similar al **API ERROR 404**. | Verifique la ficha del producto en Dolibarr. Asegúrese de que el campo "Referencia" o "Código de Barras" coincida con lo que escaneó el técnico. |
| **"Stock insuficiente para SKU..."** | El sistema revisó las bodegas internas (Hub, Casilleros, etc.) en el orden de prioridad y **ninguna** tenía saldo suficiente. | Hubo un consumo sin stock (Quiebre). Debe realizar una "Revisión de Stock" manual en Dolibarr para regularizar y luego procesar el consumo manualmente.  **\*Contactar con encargado en bodega para tomar las acciones pertinentes.** |
| **"Cantidad inválida: 0"** | El técnico ingresó un consumo de "0" o un texto en lugar de un número. | Contacte al **técnico encargado** para saber cuánto usó realmente y haga el movimiento manual en el Dolibarr. |
| **"API Error 401" / "Credenciales no configuradas"** | El sistema perdió el acceso (Contraseña incorrecta o API Key vencida). | **Llamar a TI de manera urgente.** No toque nada. Avise inmediatamente al área de TI / Desarrollador. El sistema está desconectado y se encuentra inoperativo. |

## **7.2: Guía para Desarrolladores**

* **Perfil:** Técnico. Trabaja desde Google Apps Script y Logs de Ejecución.

Esta sección explica fallos de lógica, excepciones de ejecución y problemas de integración basándose en la arquitectura del código.

| Síntoma / Exception | Análisis de Causa Raíz (Code Level) | Solución Técnica (Fix) |
| :---- | :---- | :---- |
| **Exception: API Error 500 (o 502/503)** | **Fallo en Servidor Dolibarr.** La función fetchDolibarrAPI recibió un error de servidor. Dolibarr está caído o saturado. | Revisar estado del servidor erm.eygsa.cl. Verificar logs de PHP/Apache en el servidor del ERP. Reintentar ejecución más tarde. |
| **TypeError: Cannot read property 'label' of undefined** | **Fallo en getDolibarrWarehouseLabelById.** La API devolvió un JSON inesperado o vacío al consultar /warehouses/{id}. | Verificar si el ID de bodega en EG\_WAREHOUSE\_IDS\_PRIORITY sigue existiendo. Si se borró una bodega física, quitar su ID del array constante en el código. |
| **GoogleJsonResponseException: API call to gmail.users.messages.modify failed** | **Cuota o Permisos de Gmail.** El script intentó marcar el correo como leído (message.markRead()) y falló. | Verificar cuotas de Google Apps Script (lecturas diarias). Verificar que el token OAuth no haya expirado (re-autorizar script). |
| **El script corre pero no procesa nada (Logs vacíos)** | **Filtro de "Gatekeeper".** El correo no cumple el regex subject.match o es de una tarea "Apoteca | Verificar si Fieldbeat cambió el formato del Asunto del correo. Verificar si la lógica de exclusión "Apoteca" está descartando tareas legítimas (falsos positivos). |
| **Errores silenciosos en Stock (No descuenta lo correcto)** | **Race Condition / ID Invisible.** Dolibarr devolvió un objeto en lugar de array en stock\_warehouses. | Verificar función normalizeStockResponse. Asegurar que Object.entries esté mapeando correctamente el warehouse\_id. |
| **Exceeded maximum execution time** | **Time-out de GAS (6 min).** Demasiados correos acumulados o la API de Dolibarr responde muy lento. | Reducir la frecuencia del Trigger (ej: cada 5 min). Optimizar EG\_WAREHOUSE\_IDS\_PRIORITY (poner las bodegas más probables primero para salir antes del bucle). |

# **8\. Protocolos de Corrección y Auditoría de Datos (Data Governance)** {#8.-protocolos-de-corrección-y-auditoría-de-datos-(data-governance)}

Dado que la realidad operativa puede discrepar de los registros digitales, se sugieren protocolos a seguir para la modificación de la bitácora histórica sin comprometer la integridad de la base de datos.

### **8.1. Scripts de Saneamiento Masivo (Fix Patches)**

En casos de correcciones de *bugs* de software que generaron falsos negativos (errores en el log pero stock correcto físicamente), se utilizan scripts *One-Off* (aquellos de ejecución única a modo de “parches”) para normalizar la bitácora.

* **Objetivo:** Actualizar el estado de registros históricos sin re-invocar a la API de Dolibarr (evitando duplicidad de movimientos).  
* **Formato de Trazabilidad:**  
  * **ID de Movimiento:** Se utiliza un marcador sintético con el formato FIX\_PATCH\_AAAAMMDD.  
  * **Mensaje de Error:** Se preserva el error original concatenando una nota de auditoría.  
* **Ejemplo de Registro Saneado:**  
  Estado: Éxito (Validación Manual)  
  ID Movimiento: FIX\_PATCH\_20260119  
  Mensaje: \[Error Original...\] :: ESTATUS ACTUALIZADO: modificado post fix de errores de la versión 19/01/2026 (Validado Manualmente)

### **8.2. Intervención Manual Directa**

Cuando un operador debe modificar un registro manualmente por razones administrativas, se debe seguir el estándar:

1. **Estado:** Cambiar de ERROR a Éxito (Validación Manual) o Anulado.  
2. **ID Movimiento:** Ingresar el ID del movimiento manual creado en Dolibarr o la etiqueta MANUAL\_ADJUSTMENT.  
3. **Mensaje:** Obligatorio justificar la intervención.  
   * *Formato:* \[Razón del cambio\] \- \[Iniciales Operador\] \- \[Fecha\]

   

   

   

# **9\. Disparador (Trigger)** {#9.-disparador-(trigger)}

Para que el script funcione automáticamente sin intervención humana, se debe configurar un **activador por tiempo**. Este se encargará de ejecutar el script periódicamente para revisar si han llegado nuevos correos.  
**Pasos para la configuración:**

1. En el editor de Google Apps Script, dirígete al menú de la izquierda y haz clic en el icono del **reloj** ("Activadores" o "Triggers").  
2. Haz clic en el botón azul **"Añadir activador"** (ubicado abajo a la derecha).  
3. Configura las opciones exactamente de la siguiente manera:  
   * **Función que se debe ejecutar:** mainProcess (Es vital seleccionar esta función, ya que es el punto de entrada del nuevo código).  
   * **Implementación que se debe ejecutar:** Principal (o Head).  
   * **Seleccionar fuente del evento:** Basado en tiempo.  
   * **Seleccionar tipo de activador horario:** Temporizador por minutos.  
   * **Seleccionar intervalo de minutos:** Se recomienda **Cada 5 minutos** o **Cada 10 minutos**.  
     * *Nota:* Un intervalo muy corto (ej. 1 minuto) podría generar errores de ejecución simultánea si hay muchos correos. Un intervalo de 10 o 15 minutos es seguro y eficiente.  
4. Haz clic en **Guardar**.

## 

# 

# 

# **10\. Flujo de Datos por Registro** {#10.-flujo-de-datos-por-registro}

Secuencia lógica actualizada aplicada a cada correo entrante:

1. **Ingesta:** Detección de correo no leído con asunto Reporte de tarea N° \[ID\].  
2. **Validación de Contexto (Gatekeeper):**  
   * ¿Es Cliente FALP \+ Contexto Apoteca?   
     * **SÍ**: Abortar (Log en consola "Ignorada").   
     * **NO**: Continuar.  
3. **Análisis de Contenido:**  
   * Extracción de grupos de repuestos. Si está vacío \-\> Log "Éxito (Sin Repuestos)" y finalizar.  
4. **Resolución de SKU:** Ejecución de búsqueda en cascada (Ref \-\> Like \-\> Barcode).  
5. **Estrategia de Asignación (Branching):**  
   * **Rama Interna (E\&G):**  
     * Obtener stock global del producto.  
     * Normalizar estructura JSON (Fix de IDs invisibles).  
     * Iterar lista de prioridad (EG\_WAREHOUSE\_IDS\_PRIORITY).  
     * Seleccionar primera ubicación con Stock \>= Demanda.  
   * **Rama Externa (Cliente):**  
     * Resolver ID de bodega mediante Diccionario Caché (Mapeo directo).  
6. **Resolución de Nombres:** Consultar API para nombre real \+ Diccionario para nombre de grupo.  
7. **Ejecución:** POST a /stockmovements en Dolibarr (Cantidad negativa real).  
8. **Cierre:** Registro en Sheet y marcado de correo como leído.  
   

# **11\. Control de Cambios y Evolución Arquitectónica (v2025.12 vs v2026.01.19)** {#11.-control-de-cambios-y-evolución-arquitectónica-(v2025.12-vs-v2026.01.19)}

Esta sección detalla las diferencias críticas entre la versión anterior (Diciembre 2025\) y la versión actual estable (Enero 2026), destacando las mejoras en integridad de datos, escalabilidad y rendimiento.

### **11.1. Matriz Comparativa de Funcionalidades**

| Componente / Funcionalidad | Versión Anterior (P4-v2025.12) | Versión Actual (P4-v2026.01.19) | Mejora / Impacto Técnico |
| :---- | :---- | :---- | :---- |
| **Alcance de Búsqueda (Stock)** | **Lineal Limitada:** Solo revisaba 4 bodegas principales (IDs 3, 1, 46, 17). Ignoraba casilleros. | **Jerárquica Extendida:** Barre más de 40 ubicaciones, priorizando el Hub Central y recorriendo toda la red de casilleros (IDs 23-66). | Elimina "falsos negativos". Si el stock está en un casillero específico, el sistema ahora lo encuentra. |
| **Estabilidad de API (Dolibarr)** | **Vulnerable:** Fallaba si la API devolvía objetos en lugar de arrays (Bug de "ID Invisible"), perdiendo la referencia de la bodega. | **Blindada:** Implementa la función normalizeStockResponse que inyecta y preserva el ID de la bodega sin importar el formato del JSON. | Previene errores silenciosos y excepciones de sistema por formatos de datos inconsistentes. |
| **Identificación de Producto** | **Estricta Simple:** Solo encontraba productos por coincidencia exacta de referencia. Sensible a espacios o errores. | **Búsqueda en Cascada:** Intenta 3 niveles: Referencia-\>Exacta-\> Coincidencia Parcial (LIKE)-\> Código de Barras. | Aumenta drásticamente la tasa de éxito en la identificación de SKUs, tolerando errores humanos. |
| **Resolución de Nombres** | **Estática/Manual:** Usaba IDs crudos o listas fijas en el código. Si una bodega cambiaba de nombre, el código quedaba obsoleto. | **Dinámica (Single Source of Truth):** Consulta el nombre real a la API (getDolibarrWarehouseLabelById) y lo cruza con el Diccionario. | Mantenimiento cero. El reporte siempre muestra el nombre vigente y el grupo lógico (e.i "Pañol E\&G"). |
| **Rendimiento (Diccionario)** | **Lectura Repetitiva:** Leía la hoja de cálculo cada vez que necesitaba consultar una bodega externa. Lento e ineficiente. | **Caché en Memoria:** Carga todo el diccionario en un Hash Map al inicio (DICTIONARY\_CACHE). Acceso instantáneo (O(1)). | Reduce tiempos de ejecución y consumo de cuota de lectura de Google Sheets. |

### **11.2. Detalle de Mejoras Críticas**

#### **A. Implementación de "Single Source of Truth"**

En la versión anterior, la lógica de negocio estaba fragmentada entre el código y la hoja de cálculo.

* **Antes:** El script "suponía" que el ID 66 era el Casillero 3A3 mediante constantes fijas, propenso a desincronización.  
* **Ahora:** El script trata a **Dolibarr** como la fuente de verdad para los nombres técnicos y al **Diccionario (Google Sheets)** como la fuente de verdad para la agrupación lógica. No asume información; consulta todo en tiempo de ejecución.

#### **B. Algoritmo de Búsqueda Greedy Optimizado**

El nuevo vector de prioridad EG\_WAREHOUSE\_IDS\_PRIORITY ha sido reordenado tras un análisis de datos para priorizar la probabilidad de hallazgo:

1. **Hub Central (ID 3):** Mayor probabilidad de stock masivo.  
2. **Enjambre de Casilleros (IDs 23-66):** Búsqueda secundaria inmediata.

#### **C. Saneamiento de Logs Históricos** {#c.-saneamiento-de-logs-históricos}

Se incorpora la capacidad de aplicar **"Fix Patches"** para corregir retroactivamente el estado de registros fallidos en la bitácora sin duplicar movimientos en el ERP, permitiendo una conciliación contable limpia post-incidente. Lo anterior se realiza mediante el script *FixPatch.gs* dentro del cual se encuentran los mensajes a personalizar y modificar en la variable constante NOTA\_AUDITORIA para la actualización de estado.

