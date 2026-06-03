
ALTER TABLE tbl_vendedores
    ADD COLUMN  sperant_vendedor_id INT NULL
        COMMENT 'ID del vendedor en Sperant CRM para mantener asignaciones importadas'
        AFTER id_vendedor;

ALTER TABLE tbl_sesion_conversacion
    ADD COLUMN asesor_id INT NULL
        COMMENT 'ID del vendedor asignado a este lead. Fuente: CRM=sperant, CAMPANIA=campo asesor, ORGANICO=round-robin'
        AFTER proyecto_id;


CREATE INDEX idx_sesion_conversacion_asesor_id
    ON tbl_sesion_conversacion(asesor_id);
