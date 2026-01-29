-- Tabla para vincular propiedades de MySQL con puntos en Qdrant
CREATE TABLE IF NOT EXISTS tbl_rag_propiedades (
  id_rag_propiedad INT PRIMARY KEY AUTO_INCREMENT,
  id_unidad INT NOT NULL,
  coleccion_name VARCHAR(100) NOT NULL,
  qdrant_point_id VARCHAR(50) NOT NULL,
  embedding_version VARCHAR(20) DEFAULT 'v1',
  fecha_indexado DATETIME DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizado DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (id_unidad) REFERENCES tbl_unidades_proyectos(id) ON DELETE CASCADE,
  
  UNIQUE KEY unique_unidad_coleccion (id_unidad, coleccion_name),
  INDEX idx_unidad (id_unidad),
  INDEX idx_coleccion (coleccion_name),
  INDEX idx_qdrant_point (qdrant_point_id),
  INDEX idx_fecha_indexado (fecha_indexado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Vinculación entre unidades de proyectos y vectores en Qdrant';

-- Tabla para analytics de búsquedas RAG
CREATE TABLE IF NOT EXISTS tbl_rag_analytics (
  id_analytic INT PRIMARY KEY AUTO_INCREMENT,
  id_prospecto INT,
  coleccion_name VARCHAR(100),
  
  query_original TEXT NOT NULL,
  filtros_aplicados JSON,
  propiedades_retornadas JSON COMMENT '[{id_unidad, score, rank}, ...]',
  propiedad_seleccionada INT,
  
  num_resultados INT DEFAULT 0,
  tiempo_respuesta_ms INT,
  threshold_usado DECIMAL(3,2),
  estrategia_fallback VARCHAR(20),
  
  contexto_conversacional TEXT,
  criterios_extraidos JSON COMMENT 'Criterios estructurados extraídos del contexto',
  
  fecha_query DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (id_prospecto) REFERENCES tbl_prospectos(id_prospecto) ON DELETE SET NULL,
  FOREIGN KEY (propiedad_seleccionada) REFERENCES tbl_unidades_proyectos(id) ON DELETE SET NULL,
  
  INDEX idx_prospecto (id_prospecto),
  INDEX idx_coleccion (coleccion_name),
  INDEX idx_fecha (fecha_query),
  INDEX idx_propiedad_seleccionada (propiedad_seleccionada)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Analytics de búsquedas RAG para métricas y optimización';

-- Tabla para tracking de interacciones con propiedades
CREATE TABLE IF NOT EXISTS tbl_rag_interacciones (
  id_interaccion INT PRIMARY KEY AUTO_INCREMENT,
  id_prospecto INT NOT NULL,
  id_unidad INT NOT NULL,
  id_analytic INT,
  
  tipo_interaccion VARCHAR(50) NOT NULL COMMENT 'view, click_plano, click_ubicacion, request_info, schedule_visit',
  metadata_interaccion JSON,
  
  fecha_interaccion DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (id_prospecto) REFERENCES tbl_prospectos(id_prospecto) ON DELETE CASCADE,
  FOREIGN KEY (id_unidad) REFERENCES tbl_unidades_proyectos(id) ON DELETE CASCADE,
  FOREIGN KEY (id_analytic) REFERENCES tbl_rag_analytics(id_analytic) ON DELETE SET NULL,
  
  INDEX idx_prospecto (id_prospecto),
  INDEX idx_unidad (id_unidad),
  INDEX idx_tipo (tipo_interaccion),
  INDEX idx_fecha (fecha_interaccion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tracking de interacciones del lead con propiedades mostradas';
