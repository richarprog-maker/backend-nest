-- ============================================================
-- Script: Limpiar mensajes duplicados de recovery
-- Tabla: tbl_mensajes
-- Problema: El cron envió múltiples mensajes idénticos por lead
-- Acción: Mantener solo 1 mensaje por lead_uuid + contenido,
--         eliminando los duplicados (conserva el de menor id)
-- ============================================================

-- 1. PRIMERO: Ver cuántos duplicados hay (solo consulta, no borra nada)
SELECT 
    lead_uuid,
    contenido,
    COUNT(*) as total,
    MIN(id_mensaje) as id_a_conservar,
    GROUP_CONCAT(id_mensaje ORDER BY id_mensaje) as todos_los_ids
FROM tbl_mensajes
WHERE id_emisor_tipo = 2  -- Bot
  AND fecha_envio >= '2026-02-19 10:00:00'
  AND fecha_envio <= '2026-02-19 10:10:00'
GROUP BY lead_uuid, contenido
HAVING COUNT(*) > 1;

-- 2. EJECUTAR: Eliminar duplicados, conservando el de menor id_mensaje por cada lead+contenido
DELETE m FROM tbl_mensajes m
INNER JOIN (
    SELECT lead_uuid, contenido, MIN(id_mensaje) as id_conservar
    FROM tbl_mensajes
    WHERE id_emisor_tipo = 2
      AND fecha_envio >= '2026-02-19 10:00:00'
      AND fecha_envio <= '2026-02-19 10:10:00'
    GROUP BY lead_uuid, contenido
    HAVING COUNT(*) > 1
) keep_one ON m.lead_uuid = keep_one.lead_uuid 
          AND m.contenido = keep_one.contenido
WHERE m.id_mensaje != keep_one.id_conservar
  AND m.id_emisor_tipo = 2
  AND m.fecha_envio >= '2026-02-19 10:00:00'
  AND m.fecha_envio <= '2026-02-19 10:10:00';

-- 3. VERIFICAR: Confirmar que ya no hay duplicados
SELECT 
    lead_uuid,
    contenido,
    COUNT(*) as total
FROM tbl_mensajes
WHERE id_emisor_tipo = 2
  AND fecha_envio >= '2026-02-19 10:00:00'
  AND fecha_envio <= '2026-02-19 10:10:00'
GROUP BY lead_uuid, contenido
HAVING COUNT(*) > 1;
-- Si esta query retorna 0 filas = limpieza exitosa ✅
