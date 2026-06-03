ALTER TABLE tbl_campanias
    ADD COLUMN  asesor_id INT NULL
        COMMENT 'Asesor responsable de todos los leads generados por esta campaña'
        AFTER usuario_id;


CREATE INDEX idx_campanias_asesor_id ON tbl_campanias(asesor_id);