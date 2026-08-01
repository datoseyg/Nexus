-- Unifica funcionalmente los roles "gerencia" y "administracion": desde ahora
-- ambos deben tener exactamente el mismo conjunto de capacidades en
-- governance.role_capabilities (sql/089 sección 10), única fuente de verdad
-- para requireCapability().
--
-- Antes de esta migración el seed original (sql/089:494-512) era asimétrico:
-- "administracion" tenía 12 capacidades adicionales sobre "gerencia" (revisión/
-- asignación/comentario de auditoría, todas las correcciones gobernadas, y
-- data:refresh:incremental/full). Este cambio es puramente de datos - no
-- renombra ni fusiona los dos identificadores de rol (siguen existiendo por
-- separado en NexusRole, en app_metadata.nexus_role de cada usuario, y en
-- esta misma tabla), solo espeja hacia "gerencia" cualquier capacidad que
-- "administracion" ya tenga y "gerencia" no. Es intencionalmente unidireccional
-- y solo aditivo: si en el futuro "administracion" gana una capacidad nueva,
-- esta migración NO la sincroniza retroactivamente - cada capacidad nueva
-- deberá seguir concediéndose explícitamente a ambos roles en su propio seed.
--
-- Idempotente: ON CONFLICT (role, capability) DO NOTHING, mismo estilo que el
-- seed original.

INSERT INTO governance.role_capabilities (role, capability)
SELECT 'gerencia', capability
FROM governance.role_capabilities
WHERE role = 'administracion'
ON CONFLICT (role, capability) DO NOTHING;
