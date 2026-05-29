-- ============================================================
-- MIGRACIÓN: Campo Asesor en Campañas
-- Fecha: 2026-05-28
-- ============================================================

-- Agregar columna asesor_id a las campañas masivas
-- Cuando se procesa la campaña, este asesor se propaga a todos los prospectos creados
ALTER TABLE tbl_campanias
    ADD COLUMN IF NOT EXISTS asesor_id INT NULL
        COMMENT 'Asesor responsable de todos los leads generados por esta campaña'
        AFTER usuario_id;

-- Índice para búsquedas por asesor
CREATE INDEX IF NOT EXISTS idx_campanias_asesor_id ON tbl_campanias(asesor_id);
