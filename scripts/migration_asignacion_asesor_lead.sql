-- ============================================================
-- MIGRACIÓN: Asesor en Sesión de Conversación
-- Fecha: 2026-05-28
-- ============================================================
-- FLUJO:
--   tbl_vendedores   → maestro de asesores (con sperant_vendedor_id para mapear CRM)
--   tbl_sesion_conversacion → punto de verdad: lead_uuid + asesor_id + proyecto_id
--   tbl_campanias    → asesor_id que se propaga a la sesión al procesar
-- ============================================================

-- 1. Agregar sperant_vendedor_id al vendedor (para mapear con el CRM de Sperant)
--    Ya existe codigo_asesor para el campo genérico; este es específico de Sperant
ALTER TABLE tbl_vendedores
    ADD COLUMN IF NOT EXISTS sperant_vendedor_id INT NULL
        COMMENT 'ID del vendedor en Sperant CRM para mantener asignaciones importadas'
        AFTER codigo_asesor;

-- 2. Agregar asesor_id a la sesión de conversación
--    Este campo es el ÚNICO punto de verdad de quién atiende al lead.
--    Ya existe proyecto_id en esta tabla → con asesor_id + proyecto_id tenemos todo.
ALTER TABLE tbl_sesion_conversacion
    ADD COLUMN IF NOT EXISTS asesor_id INT NULL
        COMMENT 'ID del vendedor asignado a este lead. Fuente: CRM=sperant, CAMPANIA=campo asesor, ORGANICO=round-robin'
        AFTER proyecto_id;

-- Índice para búsquedas frecuentes por asesor
CREATE INDEX IF NOT EXISTS idx_sesion_conversacion_asesor_id
    ON tbl_sesion_conversacion(asesor_id);
