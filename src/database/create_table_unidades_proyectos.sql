-- Tabla DETALLE UNIDADES/INMUEBLES (Inventario detallado)
CREATE TABLE tbl_unidades_proyectos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_proyecto INT NOT NULL, -- FK a tbl_proyectos
    
    unidad VARCHAR(50) NOT NULL, -- Nro de Unidad (ej: 1105)
    tipo_unidad VARCHAR(50), -- Tipo de Inmueble (Flat, Dúplex)
    tipologia VARCHAR(50), -- Tipología (Tipo 5)
    
    nro_piso INT,
    nro_dormitorios INT, -- Convertido a entero
    vista VARCHAR(50), -- interior, exterior
    
    area_total DECIMAL(10,2), -- Metros cuadrados
    area_techada DECIMAL(10,2),
    area_libre DECIMAL(10,2),
    
    precio_lista DECIMAL(12,2),
    moneda_lista VARCHAR(10) DEFAULT 'soles',
    
    precio_promocion DECIMAL(12,2),
    fecha_fin_promocion VARCHAR(100), -- Texto original "30 de November" -> idealmente DATE
    
    disponibilidad VARCHAR(50) DEFAULT 'Sí', -- Sí/No/Separado/Vendido
    
    -- Enlaces
    url_plano TEXT,
    url_ubicacion TEXT,
    url_plano_2 TEXT,
    
    -- Características extras (JSON para flexibilidad)
    features_json JSON, 
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (id_proyecto) REFERENCES tbl_proyectos(id) ON DELETE CASCADE,
    UNIQUE KEY uk_proyecto_unidad (id_proyecto, unidad)
);
