-- Sincroniza quality.part_no_usage_markers (sql/098) con la ampliación de
-- PLACEHOLDER_LITERALS en src/resolvers/part-identity-resolver.js (working
-- tree, previa a esta migración): ese catálogo pasó de 24 a 98 literales,
-- incorporando "no", "no hay", "ninguno", "ninguna", variantes de
-- materiales/insumos/consumo, e inglés - la mayoría de esos literales NUNCA
-- llegaban a marts.used_parts_dolibarr_match.match_status = 'PLACEHOLDER_VALUE'
-- antes de ese cambio (caían en NO_MATCH, fuera del alcance de
-- quality.classify_part_declaration, que solo reclasifica PLACEHOLDER_VALUE -
-- ver sql/098 sección 3). Ahora que sí llegan a PLACEHOLDER_VALUE, esta
-- migración decide cuáles de esos literales NUEVOS significan realmente
-- "no se utilizó repuesto" (deben marcar NO_PART_USED) frente a los que solo
-- significan "falta el identificador/dato" (deben seguir en revisión humana
-- como PLACEHOLDER_VALUE real).
--
-- Metodología: se tomaron los 98 literales de PLACEHOLDER_LITERALS, se
-- normalizaron con quality.normalize_part_declaration (la misma función que
-- usa el clasificador en producción, nunca una normalización manual aparte)
-- y se compararon contra los 10 marcadores ya existentes. De los 85 valores
-- normalizados nuevos, se clasificaron en 4 categorías:
--
--   NO_PART_USED (47, agregados abajo) - significan inequívocamente "no hubo
--     repuesto/consumo/material/insumo" (incluye variantes en inglés
--     equivalentes: none/no part/without part/not applicable/not required).
--   MISSING_IDENTIFIER (10, NO agregados) - "sin número/serie/código/id/nro"
--     y "s/n"/"sn": describen un repuesto SIN identificar, no la ausencia de
--     repuesto - mismo criterio ya establecido en sql/098 para "sin numero".
--   GENERIC_PLACEHOLDER (17, NO agregados) - "sin información/dato(s)",
--     "no informado/ingresado/indicado", "desconocido/a", "pendiente", "por
--     confirmar/definir", "unknown", "no information": indican un campo
--     vacío en general, no una declaración de "cero repuestos".
--   AMBIGUOUS_REQUIRES_REVIEW (10, NO agregados) - "no tiene/tienen",
--     "no posee/poseen", "no presenta/presentan", "no registra/registrado/a",
--     "no disponible": el referente de la negación no es inequívoco (p.ej.
--     "no disponible" puede significar que SÍ se necesitaba un repuesto pero
--     no había stock - la implicación opuesta a NO_PART_USED). Ninguno de
--     estos apareció en la lista de referencia de negocio entregada para esta
--     tarea; se dejan deliberadamente fuera del catálogo automático. "no
--     tiene" ya existía en PLACEHOLDER_LITERALS antes de esta ampliación y
--     el catálogo original (sql/098) tampoco lo incluyó - se mantiene la
--     misma decisión, no se revierte.
--
-- La cadena vacía ("") también se agregó a PLACEHOLDER_LITERALS en esta
-- ampliación, pero no requiere marcador: quality.classify_part_declaration
-- ya trata cualquier valor cuyo normalize_part_declaration() sea '' como
-- NO_PART_USED directamente (sql/098 sección 3, rama
-- "normalize_part_declaration(...) = ''"), sin necesitar una fila en la
-- tabla de marcadores.
-- ============================================================================
INSERT INTO quality.part_no_usage_markers (normalized_value, source) VALUES
  -- Ausencia explícita
  ('nada', 'PLACEHOLDER_LITERALS: "nada" - ausencia explícita, inequívoco'),
  ('ningun', 'PLACEHOLDER_LITERALS: "ningún"/"ningun" - variante corta de ninguno/ninguna, ya presentes'),

  -- No existe / no aplica / no corresponde / no procede / no requerido
  ('noexiste', 'PLACEHOLDER_LITERALS: "no existe"'),
  ('noexisten', 'PLACEHOLDER_LITERALS: "no existen"'),
  ('noaplicable', 'PLACEHOLDER_LITERALS: "no aplicable" - sinónimo de "no aplica", ya presente'),
  ('nocorrespondia', 'PLACEHOLDER_LITERALS: "no correspondía"/"no correspondia"'),
  ('noprocede', 'PLACEHOLDER_LITERALS: "no procede"'),
  ('norequerido', 'PLACEHOLDER_LITERALS: "no requerido"'),
  ('norequerida', 'PLACEHOLDER_LITERALS: "no requerida"'),
  ('norequiere', 'PLACEHOLDER_LITERALS: "no requiere"'),
  ('noserequiere', 'PLACEHOLDER_LITERALS: "no se requiere"'),

  -- Ausencia explícita de repuesto (todas mencionan "repuesto(s)" - sin ambigüedad)
  ('sinusoderepuesto', 'PLACEHOLDER_LITERALS: "sin uso de repuesto"'),
  ('sinusoderepuestos', 'PLACEHOLDER_LITERALS: "sin uso de repuestos"'),
  ('sinutilizarrepuesto', 'PLACEHOLDER_LITERALS: "sin utilizar repuesto"'),
  ('sinutilizarrepuestos', 'PLACEHOLDER_LITERALS: "sin utilizar repuestos"'),
  ('noutilizorepuesto', 'PLACEHOLDER_LITERALS: "no utilizó repuesto"/"no utilizo repuesto"'),
  ('noutilizorepuestos', 'PLACEHOLDER_LITERALS: "no utilizó repuestos"/"no utilizo repuestos"'),
  ('noseutilizorepuesto', 'PLACEHOLDER_LITERALS: "no se utilizó repuesto"/"no se utilizo repuesto"'),
  ('noseutilizaronrepuestos', 'PLACEHOLDER_LITERALS: "no se utilizaron repuestos"'),
  ('noseusorepuesto', 'PLACEHOLDER_LITERALS: "no se usó repuesto"/"no se uso repuesto"'),
  ('noseusaronrepuestos', 'PLACEHOLDER_LITERALS: "no se usaron repuestos"'),
  ('repuestonoutilizado', 'PLACEHOLDER_LITERALS: "repuesto no utilizado"'),
  ('repuestosnoutilizados', 'PLACEHOLDER_LITERALS: "repuestos no utilizados"'),

  -- Ausencia de consumo
  ('noconsume', 'PLACEHOLDER_LITERALS: "no consume" (ya estaba en el catálogo de placeholders desde antes, nunca se había agregado como marcador)'),
  ('noconsumio', 'PLACEHOLDER_LITERALS: "no consumió"/"no consumio"'),
  ('noseconsumio', 'PLACEHOLDER_LITERALS: "no se consumió"/"no se consumio"'),
  ('sinconsumo', 'PLACEHOLDER_LITERALS: "sin consumo" (mismo caso que "no consume")'),
  ('sinconsumos', 'PLACEHOLDER_LITERALS: "sin consumos"'),

  -- Ausencia de materiales o insumos - equivalente de negocio a "sin
  -- repuesto" en reportes FieldBeat (técnicos usan "material"/"insumo" y
  -- "repuesto" indistintamente), confirmado por el enunciado de esta tarea
  -- ("No hubo consumo de materiales o insumos" listado como idea equivalente
  -- a NO_PART_USED).
  ('sinmaterial', 'PLACEHOLDER_LITERALS: "sin material"'),
  ('sinmateriales', 'PLACEHOLDER_LITERALS: "sin materiales"'),
  ('sininsumo', 'PLACEHOLDER_LITERALS: "sin insumo"'),
  ('sininsumos', 'PLACEHOLDER_LITERALS: "sin insumos"'),
  ('noseusaronmateriales', 'PLACEHOLDER_LITERALS: "no se usaron materiales"'),
  ('noseutilizaronmateriales', 'PLACEHOLDER_LITERALS: "no se utilizaron materiales"'),
  ('noseusaroninsumos', 'PLACEHOLDER_LITERALS: "no se usaron insumos"'),
  ('noseutilizaroninsumos', 'PLACEHOLDER_LITERALS: "no se utilizaron insumos"'),

  -- Inglés - mismo criterio que sus equivalentes en español de arriba
  -- (se excluyen deliberadamente "no information"/"unknown": son el
  -- equivalente inglés de "sin información"/"desconocido", clasificados
  -- GENERIC_PLACEHOLDER, no NO_PART_USED).
  ('none', 'PLACEHOLDER_LITERALS: "none"'),
  ('notapplicable', 'PLACEHOLDER_LITERALS: "not applicable"'),
  ('notrequired', 'PLACEHOLDER_LITERALS: "not required"'),
  ('nopart', 'PLACEHOLDER_LITERALS: "no part"'),
  ('noparts', 'PLACEHOLDER_LITERALS: "no parts"'),
  ('nosparepart', 'PLACEHOLDER_LITERALS: "no spare part"'),
  ('nospareparts', 'PLACEHOLDER_LITERALS: "no spare parts"'),
  ('withoutpart', 'PLACEHOLDER_LITERALS: "without part"'),
  ('withoutparts', 'PLACEHOLDER_LITERALS: "without parts"'),
  ('nomaterial', 'PLACEHOLDER_LITERALS: "no material"'),
  ('nomaterials', 'PLACEHOLDER_LITERALS: "no materials"')
ON CONFLICT (normalized_value) DO NOTHING;
