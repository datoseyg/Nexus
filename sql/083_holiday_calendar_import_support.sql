-- ETAPA 6.6B1 -- Extiende el vocabulario de config.holiday_calendar_entries.
-- holiday_type SIN modificar sql/080_holiday_calendar.sql (ya congelado,
-- ETAPA 6.6B0). Migración autocontenida, aplicada después de 080.
--
-- Motivo (gate de compatibilidad, ver informe de 6.6B1 §5): las fuentes
-- oficiales reales (Ley N°18.700 Art. 180 -"el día que se fije para la
-- realización de las elecciones y plebiscitos será feriado legal"-, y los
-- feriados extraordinarios de una sola ocurrencia que de ahí se derivan)
-- no encajan honestamente en FIXED_DATE/MOVABLE/REGIONAL. Clasificar un
-- feriado electoral como MOVABLE solo para satisfacer el CHECK existente
-- sería incorrecto (MOVABLE implica recurrencia calculable año a año, ej.
-- Semana Santa; un feriado electoral no recurre con ninguna regla fija).
--
-- REGIONAL sigue expresando ALCANCE geográfico (no recurrencia) -convive
-- sin conflicto con ELECTION/ONE_OFF, que expresan el motivo/naturaleza del
-- evento. Un feriado podría en principio ser tanto ELECTION como de alcance
-- regional (ej. una segunda vuelta de gobernador regional que solo aplica a
-- una región) -esta migración no resuelve esa intersección de dimensiones
-- (alcance vs. naturaleza) en un modelo más rico; se documenta como
-- limitación conocida, no se hace una refactorización extensa del modelo en
-- esta subetapa.

ALTER TABLE config.holiday_calendar_entries DROP CONSTRAINT IF EXISTS holiday_calendar_entries_holiday_type_check;
ALTER TABLE config.holiday_calendar_entries ADD CONSTRAINT holiday_calendar_entries_holiday_type_check
  CHECK (holiday_type IN ('FIXED_DATE', 'MOVABLE', 'REGIONAL', 'ELECTION', 'ONE_OFF'));

-- Idempotente: correr este archivo dos veces produce el mismo estado final
-- (DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT con el mismo texto).

-- ============================================================
-- Rollback (referencia manual, NO ejecutado automáticamente)
-- ============================================================
-- Solo aplicable si NINGUNA fila usa ELECTION/ONE_OFF todavía -de lo
-- contrario el ALTER fallaría al violar el CHECK sobre filas existentes;
-- en ese caso, decidir una remediación de datos antes de revertir.
--
--   ALTER TABLE config.holiday_calendar_entries DROP CONSTRAINT IF EXISTS holiday_calendar_entries_holiday_type_check;
--   ALTER TABLE config.holiday_calendar_entries ADD CONSTRAINT holiday_calendar_entries_holiday_type_check
--     CHECK (holiday_type IN ('FIXED_DATE', 'MOVABLE', 'REGIONAL'));
