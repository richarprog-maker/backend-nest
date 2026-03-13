CREATE TABLE IF NOT EXISTS tbl_eventos_webhook_sperant (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    tipo_evento VARCHAR(80) NOT NULL,
    cliente_id_sperant INT NULL,
    llave_idempotencia VARCHAR(128) NOT NULL,
    correlation_id VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    intentos INT NOT NULL DEFAULT 0,
    lead_uuid VARCHAR(36) NULL,
    error_ultimo TEXT NULL,
    procesado_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_webhook_sperant_empresa_llave (codigo_empresa, llave_idempotencia),
    KEY idx_webhook_sperant_lead (lead_uuid)
);

CREATE TABLE IF NOT EXISTS tbl_mapeos_contactos_sperant (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    lead_id INT NOT NULL,
    lead_uuid VARCHAR(36) NOT NULL,
    cliente_id_sperant INT NOT NULL,
    documento VARCHAR(30) NULL,
    email VARCHAR(150) NULL,
    telefono VARCHAR(30) NULL,
    estado VARCHAR(30) NOT NULL DEFAULT 'activo',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_contacto_sperant_empresa_cliente (codigo_empresa, cliente_id_sperant),
    UNIQUE KEY uq_contacto_sperant_empresa_lead (codigo_empresa, lead_uuid),
    CONSTRAINT fk_contacto_sperant_lead_uuid
        FOREIGN KEY (lead_uuid) REFERENCES tbl_leads(uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tbl_sincronizaciones_citas_sperant (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    id_cita_local INT NULL,
    lead_uuid VARCHAR(36) NOT NULL,
    cliente_id_sperant INT NOT NULL,
    evento_id_sperant INT NULL,
    proyecto_id_local INT NULL,
    proyecto_id_sperant INT NULL,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    payload_request JSON NULL,
    payload_response JSON NULL,
    error_ultimo TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_sync_citas_sperant_cita_local (id_cita_local),
    KEY idx_sync_citas_sperant_lead (lead_uuid)
);

CREATE TABLE IF NOT EXISTS tbl_sincronizaciones_proformas_sperant (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    lead_uuid VARCHAR(36) NOT NULL,
    cliente_id_sperant INT NOT NULL,
    proforma_id_sperant INT NULL,
    proyecto_id_local INT NULL,
    proyecto_id_sperant INT NULL,
    unidad_id_sperant INT NULL,
    tipo_id_sperant INT NULL,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    payload_request JSON NULL,
    payload_response JSON NULL,
    error_ultimo TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_sync_proformas_sperant_lead (lead_uuid)
);

/*
Ejemplo de vinculación inicial de proyectos locales con SPERANT.
Ajusta los IDs locales según tu base antes de ejecutar.

UPDATE tbl_proyectos SET sperant_project_id = 1 WHERE id = 8;
UPDATE tbl_proyectos SET sperant_project_id = 2 WHERE id = 9;
UPDATE tbl_proyectos SET sperant_project_id = 3 WHERE id = 6;
*/
