-- ============================================
-- MIGRACION: Soporte Multi-Proyecto
-- Ejecutar en produccion ANTES del despliegue
-- ============================================

-- 1. Insertar nuevos proyectos
INSERT INTO
    tbl_proyectos (
        codigo_empresa,
        nombre,
        descripcion,
        tipo_inmueble,
        ubicacion,
        moneda,
        estado,
        json_data
    )
VALUES (
        1,
        'Los Cerezos',
        NULL,
        'Flat',
        NULL,
        'USD',
        'activo',
        '{"etapa_actual":"","tipos_unidades":"Flat","horario_atencion":[],"exhibicion_unidades":"","direccion_sala_ventas":"","fecha_estimada_entrega":""}'
    ),
    (
        1,
        'Porta 360',
        NULL,
        'Flat',
        NULL,
        'USD',
        'activo',
        '{"etapa_actual":"","tipos_unidades":"Flat","horario_atencion":[],"exhibicion_unidades":"","direccion_sala_ventas":"","fecha_estimada_entrega":""}'
    );

-- 2. Agregar proyecto_id a campanias
ALTER TABLE tbl_campanias
ADD COLUMN proyecto_id INT NULL AFTER codigo_empresa;

ALTER TABLE tbl_campanias
ADD CONSTRAINT fk_campanias_proyecto FOREIGN KEY (proyecto_id) REFERENCES tbl_proyectos (id);

-- 3. Agregar proyecto_id a sesion de conversacion
ALTER TABLE tbl_sesion_conversacion
ADD COLUMN proyecto_id INT NULL AFTER codigo_empresa;

-- 4. Tabla vendedores-proyectos (relacion N:N entre vendedores y proyectos)
CREATE TABLE IF NOT EXISTS tbl_vendedores_proyectos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_vendedor INT NOT NULL,
    proyecto_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_vendedor_proyecto (id_vendedor, proyecto_id),
    CONSTRAINT fk_vp_vendedor FOREIGN KEY (id_vendedor) REFERENCES tbl_vendedores (id_vendedor),
    CONSTRAINT fk_vp_proyecto FOREIGN KEY (proyecto_id) REFERENCES tbl_proyectos (id)
);

ALTER TABLE tbl_citas
ADD COLUMN proyecto_id INT NULL AFTER estado_cita,
ADD COLUMN nombre_proyecto VARCHAR(100) NULL AFTER proyecto_id;