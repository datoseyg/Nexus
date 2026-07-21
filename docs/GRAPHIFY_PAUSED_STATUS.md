# Graphify — estado pausado

> Estado observado el 20 de julio de 2026. Las cifras de nodos y relaciones son
> provisionales: todavía no existe `graphify-out/graph.json` y el pipeline no ha
> completado el ensamblado, la validación, el clustering ni los reportes finales.

## Motivo

La integración queda pausada temporalmente para priorizar la entrega de la demo
productiva de NEXUS y la implementación del Explorador.

## Estado alcanzado

- Extracción inicial realizada: sí, de forma parcial.
- Corpus detectado: 640 archivos y aproximadamente 993.224 palabras.
- Archivos o áreas detectadas:
  - 440 archivos de código.
  - 180 documentos.
  - 5 PDF.
  - 15 imágenes.
  - 0 archivos de audio o video.
  - 4 archivos sensibles omitidos por el detector.
- Archivos o áreas procesadas:
  - Extracción estructural AST de los 440 archivos de código.
  - Extracción semántica parcial de documentos, PDF e imágenes.
- Archivos todavía pendientes:
  - `graphify-out/.graphify_missing.txt` registra 141 rutas pendientes del
    reintento semántico.
  - `graphify-out/.graphify_uncached.txt` conserva 200 rutas sin resultado de
    caché al comenzar esa ronda. Esta lista es histórica y no debe interpretarse
    como el pendiente actual sin reconciliarla con los chunks ya producidos.
- Chunks planificados en la segunda ronda: 14 (7 de documentos y 7 de imágenes).
- Chunks materializados en la segunda ronda: 2
  (`.graphify_chunk_r2_01.json` y `.graphify_chunk_r2_04.json`).
- Chunks pendientes o sin artefacto verificable en esa ronda: 12.
- Nodos generados antes del ensamblado final:
  - 1.995 estructurales (AST).
  - 233 semánticos parciales.
  - 2.228 en total bruto. Aún no se ha realizado la deduplicación final.
- Relaciones generadas antes del ensamblado final:
  - 5.277 estructurales (AST).
  - 224 semánticas parciales.
  - 5.501 en total bruto, además de 20 hiperrelaciones semánticas.
- Tokens registrados por la extracción semántica parcial:
  - 460.896 de entrada.
  - 16.796 de salida.
- Errores conocidos:
  - La extracción semántica quedó incompleta.
  - No existe `graphify-out/graph.json`; por tanto, el grafo todavía no es
    consultable ni puede considerarse validado.
  - No existen todavía `GRAPH_REPORT.md`, visualización HTML, wiki, comunidades
    ni chequeo final de integridad.
  - El corpus detectado supera el umbral recomendado de 500 archivos. Incluye
    herramientas y skills locales (`.agents/` y `.claude/`) que deben revisarse
    como candidatos a exclusión antes de reanudar.
- Límites de cuota encontrados: no hay evidencia persistida suficiente para
  atribuir la pausa a un error de cuota o a un código 429. No asumir un límite
  concreto sin recuperar el log de la ejecución original.
- Comandos utilizados: el historial exacto de la ejecución original no quedó
  persistido. Los artefactos prueban que se ejecutaron las etapas de detección,
  extracción AST y extracción semántica por chunks; no se documentan como
  “ejecutados” comandos que no puedan verificarse.

## Archivos modificados o generados por Graphify

- `.graphifyignore` (configuración observada, pendiente de validar).
- `graphify-out/.graphify_detect.json`.
- `graphify-out/.graphify_ast.json`.
- `graphify-out/.graphify_semantic.json`.
- `graphify-out/.graphify_uncached.txt`.
- `graphify-out/.graphify_missing.txt`.
- `graphify-out/.graphify_doc_list.txt`.
- `graphify-out/.graphify_img_list.txt`.
- `graphify-out/.graphify_r2_doc_*.txt`.
- `graphify-out/.graphify_r2_img_*.txt`.
- `graphify-out/.graphify_chunk_r2_*.json`.
- `graphify-out/cache/`.

Estos archivos son artefactos de trabajo de Graphify. No forman parte del
contrato productivo de datos de NEXUS.

## Cómo continuar

1. Guardar o recuperar, si existe, el log original de ejecución para identificar
   la causa exacta de los chunks incompletos y cualquier límite de cuota.
2. Revisar `.graphifyignore` y excluir del corpus herramientas, skills, outputs,
   dependencias y otros directorios que no describan la aplicación NEXUS.
3. Volver a ejecutar la detección y comprobar que el alcance resultante es el
   esperado antes de consumir tokens en extracción semántica.
4. Reconciliar los 141 pendientes con la caché y con los dos chunks de la segunda
   ronda ya materializados. No mezclar resultados duplicados.
5. Reanudar la extracción semántica en chunks pequeños y conservar el resultado
   y el log de cada chunk.
6. Ensamblar AST y semántica, deduplicar y ejecutar el chequeo de integridad.
7. Generar `graph.json`, comunidades y reportes únicamente después de que no
   falten chunks y el chequeo de integridad sea aceptable.
8. Validar los resultados contra el código y la documentación fuente antes de
   habilitar consultas o considerar un despliegue.

Comando recomendado después de corregir el alcance, ejecutado desde la raíz del
repositorio:

```powershell
graphify .
```

No usar `graphify update .` mientras no exista un grafo final validado; el estado
actual es un pipeline intermedio, no una base incremental confiable.

## Restricciones

- No utilizar datos generados por Graphify como dependencia obligatoria del
  Explorador.
- No mezclar Graphify con el contrato de datos productivo.
- No desplegar Graphify hasta completar su validación.
- Mantener `graphify-out/` como artefacto auxiliar y regenerable.
- Toda afirmación derivada del grafo debe conservar referencia a su archivo
  fuente y distinguir relaciones extraídas, inferidas y ambiguas.
