CREATE TABLE IF NOT EXISTS tbl_plantillas_notificaciones_asesores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    canal ENUM('WHATSAPP', 'EMAIL') NOT NULL,
    evento ENUM('CITA_LEAD_CALIENTE') NOT NULL,
    asunto VARCHAR(255) NULL,
    contenido TEXT NOT NULL,
    nombre_template_whatsapp VARCHAR(255) NULL,
    parametros JSON NULL,
    idioma VARCHAR(20) NOT NULL DEFAULT 'es_PE',
    activo TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_plantilla_notificacion_asesor (codigo_empresa, canal, evento, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tbl_plantillas_notificaciones_asesores (
    codigo_empresa,
    nombre,
    canal,
    evento,
    asunto,
    contenido,
    nombre_template_whatsapp,
    parametros,
    idioma,
    activo
)
VALUES
(
    1,
    'notificacion_cita_asesor_email',
    'EMAIL',
    'CITA_LEAD_CALIENTE',
    'Nueva cita agendada con lead caliente',
    'Hola {{asesor_nombre}}, tienes una nueva cita con un lead caliente.\n\nLead: {{lead_nombre}}\nTelefono: {{lead_telefono}}\nEmail: {{lead_email}}\nProyecto: {{proyecto}}\nFecha: {{fecha_cita}}\nHora: {{hora_cita}}\nTipo: {{tipo_cita}}\nCita ID: {{cita_id}}',
    NULL,
    '["asesor_nombre", "lead_nombre", "lead_telefono", "lead_email", "proyecto", "fecha_cita", "hora_cita", "tipo_cita", "cita_id"]',
    'es_PE',
    1
),
(
    1,
    'notificacion_cita_asesor_whatsapp',
    'WHATSAPP',
    'CITA_LEAD_CALIENTE',
    NULL,
    'Hola {{asesor_nombre}}, tienes una nueva cita con un lead caliente.\n\nLead: {{lead_nombre}}\nTelefono: {{lead_telefono}}\nEmail: {{lead_email}}\nProyecto: {{proyecto}}\nFecha: {{fecha_cita}}\nHora: {{hora_cita}}\nTipo: {{tipo_cita}}\nCita ID: {{cita_id}}',
    NULL,
    '["asesor_nombre", "lead_nombre", "lead_telefono", "lead_email", "proyecto", "fecha_cita", "hora_cita", "tipo_cita", "cita_id"]',
    'es_PE',
    1
)
ON DUPLICATE KEY UPDATE
    nombre = VALUES(nombre),
    asunto = VALUES(asunto),
    contenido = VALUES(contenido),
    parametros = VALUES(parametros),
    idioma = VALUES(idioma);
