-- Migracion: Tabla de colecciones Qdrant y datos de unidades
-- Ejecutar despues de migration_multi_proyecto.sql

-- 1. Crear tabla de colecciones Qdrant
CREATE TABLE IF NOT EXISTS tbl_colecciones_qdrant (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_proyecto INT NOT NULL,
    tipo_coleccion ENUM('faq', 'inventario') NOT NULL,
    nombre_coleccion VARCHAR(100) NOT NULL,
    estado VARCHAR(20) DEFAULT 'activo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (id_proyecto) REFERENCES tbl_proyectos (id),
    UNIQUE KEY uk_proyecto_tipo (id_proyecto, tipo_coleccion)
);

-- 2. Insertar colecciones por proyecto
INSERT INTO
    tbl_colecciones_qdrant (
        id_proyecto,
        tipo_coleccion,
        nombre_coleccion
    )
VALUES (1, 'faq', 'checor-faq-1'),
    (
        1,
        'inventario',
        'checor-inventory-1'
    ),
    (2, 'faq', 'checor-faq-2'),
    (
        2,
        'inventario',
        'checor-inventory-2'
    ),
    (3, 'faq', 'checor-faq-3'),
    (
        3,
        'inventario',
        'checor-inventory-3'
    )
ON DUPLICATE KEY UPDATE
    nombre_coleccion = VALUES(nombre_coleccion);