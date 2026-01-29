-- ==========================================================
-- SCRIPT DE MIGRACIÓN COMPLETA - CHECOR BACKEND
-- ==========================================================
-- Este script crea la base de datos `db_checor` nueva y todas sus tablas.
-- Ejecutar en MySQL WorkBench o CLI.

-- 1. Crear Base de Datos
CREATE DATABASE IF NOT EXISTS db_checorv2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE db_checorv2;

-- 2. Tabla de VENDEDORES/USUARIOS
CREATE TABLE tbl_vendedores (
    id_vendedor INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100),
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL, -- Hash
    rol VARCHAR(50) DEFAULT 'vendedor', -- admin, vendedor
    telefono VARCHAR(20),
    estado_vendedor VARCHAR(20) DEFAULT 'activo',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_email_empresa (email, codigo_empresa)
);

-- 2.1 Tabla de EMPRESAS (Configuración)
CREATE TABLE tbl_empresas (
    id_empresa INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario_admin INT,
    nombre VARCHAR(100) NOT NULL,
    estado INT DEFAULT 1,
    
    -- Datos de Contacto
    telefono VARCHAR(20),
    email VARCHAR(100),
    direccion VARCHAR(255),
    ciudad VARCHAR(100),
    pais VARCHAR(100),
    
    -- Branding
    logo_url VARCHAR(255),
    web_url VARCHAR(255),
    redes_sociales JSON, -- Facebook, Instagram, TikTok, etc.
    
    descripcion TEXT,
    slogan TEXT,
    
    rubro VARCHAR(100),
    configuracion_json JSON, -- Configs extras
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed Empresa Checor
INSERT INTO tbl_empresas (id_empresa, id_usuario_admin, nombre, estado, telefono, email, direccion, ciudad, pais, logo_url, web_url, redes_sociales, descripcion, slogan, rubro, configuracion_json)
VALUES (1, 1, 'Checor', 1, '', '', '', 'Lima', '', '', 'https://checor.com/', '{"tiktok": "https://www.tiktok.com/@vidarqinmobiliaria", "youtube": "https://www.youtube.com/@vidarqinmobiliaria", "facebook": "https://www.facebook.com/vidarqinmobiliaria/?locale=es_LA", "linkedin": "https://pe.linkedin.com/company/constructora-e-inmobiliaria-vidarq", "whatsapp": "981 281 601", "instagram": "https://www.instagram.com/vidarqinmobiliaria/"}', 'Somos una inmobiliaria y constructora con más de 20 años de experiencia en el desarrollo, construcción y venta de departamentos en Lima.', 'Checor es una marca cercana y confiable, que acompaña a las personas en el proceso de comprar su primer departamento.', '', NULL)
ON DUPLICATE KEY UPDATE nombre=nombre;


-- 3. Tabla MAESTRA DE LEADS (Identidad)
CREATE TABLE tbl_leads (
    id_lead INT AUTO_INCREMENT PRIMARY KEY,
    uuid VARCHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
    codigo_empresa INT NOT NULL,
    
    nombre VARCHAR(100),
    apellido VARCHAR(100),
    telefono_principal VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    dni VARCHAR(20),
    
    pais VARCHAR(50),
    ciudad VARCHAR(50),
    direccion VARCHAR(255),

    fecha_nacimiento DATE,
    genero VARCHAR(50),
    
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_telefono_empresa (telefono_principal, codigo_empresa)
);

-- 3.2 Tabla PROYECTOS (Inmuebles/Productos)
CREATE TABLE tbl_proyectos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    
    tipo_inmueble VARCHAR(50) DEFAULT 'Departamento', -- Flat, Duplex, etc.
    ubicacion VARCHAR(200),
    
    precio_desde DECIMAL(12,2),
    moneda VARCHAR(10) DEFAULT 'USD',
    
    estado VARCHAR(20) DEFAULT 'activo', -- activo, vendido, preventa
    
    sperant_project_id INT, -- Mapeo con CRM externo
    
    json_data JSON, -- Urls imagenes, planos, etc.
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed Proyecto Los Lirios
INSERT INTO tbl_proyectos (id, codigo_empresa, nombre, tipo_inmueble, sperant_project_id) 
VALUES (1, 1, 'Los Lirios', 'Flat', 1) 
ON DUPLICATE KEY UPDATE nombre=nombre;

-- 3.1 Tabla ORIGENES DE DATOS
CREATE TABLE tbl_origenes_datos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE
);
-- Seed
INSERT INTO tbl_origenes_datos (id, nombre) VALUES (1, 'Excel'), (2, 'Sperant'), (3, 'WhatsApp') ON DUPLICATE KEY UPDATE nombre=nombre;

-- 4. Tabla DETALLE PROSPECTOS (Oportunidad)
CREATE TABLE tbl_prospectos (
    id_prospecto INT AUTO_INCREMENT PRIMARY KEY,
    id_lead INT NOT NULL,
    codigo_empresa INT NOT NULL,
    
    interes_tipo_id INT, -- ID Proyecto
    interes_nombre VARCHAR(100),
    origen_dato VARCHAR(50), 
    origen_id INT,
    
    estado_gestion VARCHAR(50) DEFAULT 'nuevo',
    observacion TEXT,
    
    json_data JSON, -- Data cruda
    
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (id_lead) REFERENCES tbl_leads(id_lead)
);

-- 5. Tabla de MENSAJES (Chat)
CREATE TABLE tbl_mensajes (
    id_mensaje INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    
    lead_uuid VARCHAR(36), -- FK a tbl_leads
    id_usuario INT, -- ID Vendedor (null si es lead o bot)
    id_emisor_tipo INT, -- 1=Lead, 2=Bot, 3=Asesor
    
    contenido TEXT,
    numero_telefono VARCHAR(20),
    
    tipo_multimedia VARCHAR(50),
    url_multimedia TEXT,
    
    estado_mensaje VARCHAR(50),
    wamid_msg VARCHAR(100),
    leido TINYINT DEFAULT 0,
    
    fecha_envio TIMESTAMP,
    fecha_recibido TIMESTAMP,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (lead_uuid) REFERENCES tbl_leads(uuid) ON DELETE CASCADE
);

-- Índices Mensajes
CREATE INDEX idx_msg_lead ON tbl_mensajes(lead_uuid);
CREATE INDEX idx_msg_empresa ON tbl_mensajes(codigo_empresa);

-- 6. Tabla de CITAS
CREATE TABLE tbl_citas (
    id_cita INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    
    lead_uuid VARCHAR(36), -- FK a tbl_leads
    id_vendedor INT,
    
    nombre_proyecto VARCHAR(100),
    fecha_cita DATE,
    hora_cita TIME,
    tipo_cita VARCHAR(20), -- presencial/virtual
    estado_cita VARCHAR(20) DEFAULT 'pendiente',
    observacion TEXT,
    
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (id_vendedor) REFERENCES tbl_vendedores(id_vendedor),
    FOREIGN KEY (lead_uuid) REFERENCES tbl_leads(uuid) ON DELETE CASCADE
);

-- 7. Tabla de CAMPAÑAS
CREATE TABLE tbl_campanias (
    id_campania INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    
    nombre_campania VARCHAR(100),
    fecha_programada DATETIME,
    mensaje TEXT,
    estado VARCHAR(20) DEFAULT 'borrador', 
    
    cantidad_total INT DEFAULT 0,
    cantidad_enviados INT DEFAULT 0,
    cantidad_fallidos INT DEFAULT 0,
    
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 8. Tabla DETALLE CAMPAÑA PROSPECTOS
CREATE TABLE tbl_campania_prospectos (
    id_detalle INT AUTO_INCREMENT PRIMARY KEY,
    id_campania INT NOT NULL,
    lead_uuid VARCHAR(36), -- FK a tbl_leads
    
    estado_envio VARCHAR(20) DEFAULT 'pendiente',
    error_detalle TEXT,
    fecha_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (id_campania) REFERENCES tbl_campanias(id_campania)
    -- FOREIGN KEY (lead_uuid) REFERENCES tbl_leads(uuid) -- Opcional, si se desea integridad
);

-- 9. Tabla WEBHOOK CREDENCIALES
CREATE TABLE tbl_crendenciales_wapi (
    id_credential INT AUTO_INCREMENT PRIMARY KEY,
    codigo_empresa INT NOT NULL,
    
    wapi_token TEXT,
    wapi_phone_id VARCHAR(50),
    wapi_business_id VARCHAR(50),
    app_id VARCHAR(50),
    verify_token VARCHAR(50),
    
    estado TINYINT DEFAULT 1,
    
    UNIQUE KEY uk_credencial_empresa (codigo_empresa)
);

-- 10. Tabla HISTORIAL DE CHAT CON IA (Optimizada para LangChain)
-- ================================================================
-- Esta tabla guarda el historial de conversaciones con la IA para cada lead.
-- Está optimizada para minimizar el consumo de tokens al pasar contexto al LLM.
-- Se almacenan los últimos N mensajes (típicamente 12-20) por conversación.
-- Los mensajes antiguos se pueden archivar o eliminar según políticas de retención.
-- ================================================================
CREATE TABLE tbl_historial_chat_ai (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Relación directa con Lead
    lead_uuid VARCHAR(36) NOT NULL,
    codigo_empresa INT NOT NULL,
    
    -- Mensaje completo en formato JSON (LangChain compatible)
    -- Estructura: { role: 'user'|'assistant'|'system'|'function', content: '...', type: '...' }
    input JSON NOT NULL,
    
    -- Rol del mensaje para filtrado rápido: 'user', 'assistant', 'system', 'function'
    role VARCHAR(20) NOT NULL,
    
    -- Tokens consumidos (para análisis de costos)
    tkn_input INT DEFAULT 0,
    tkn_output INT DEFAULT 0,
    
    -- Modelo de IA utilizado (ej: 'gpt-4', 'gpt-3.5-turbo')
    nombre_modelo VARCHAR(50) DEFAULT 'gpt-4o-mini',
    
    -- Metadatos extendidos en JSON (datos importantes extraídos por la IA)
    metadatos JSON DEFAULT NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    FOREIGN KEY (lead_uuid) REFERENCES tbl_leads(uuid) ON DELETE CASCADE,
    
    -- Índices para optimizar consultas
    INDEX idx_lead_empresa (lead_uuid, codigo_empresa),
    INDEX idx_role (role),
    INDEX idx_created (created_at),
    INDEX idx_lead_role (lead_uuid, role)
);

-- 11. Tabla SESIÓN DE CONVERSACIÓN (Control de contexto activo)
-- ================================================================
-- Administra las sesiones de conversación activas para gestión de contexto.
-- Permite implementar estrategias de recuperación de leads inactivos.
-- Se actualiza automáticamente con TRIGGER cuando se inserta mensaje en tbl_historial_chat_ai
-- ================================================================
CREATE TABLE tbl_sesion_conversacion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Relación directa con Lead
    lead_uuid VARCHAR(36) NOT NULL,
    codigo_empresa INT NOT NULL,
    
    -- ID del primer mensaje que inició esta sesión
    id_msj_inicio INT,
    
    -- Timestamp del último mensaje para detectar inactividad (actualizado por trigger)
    fecha_hora_ultimo_msj TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Minutos para próximo mensaje de recuperación
    proximo_mensaje_minutos INT DEFAULT 60,
    
    -- Metadatos de la sesión (perfil del contacto, estado, etc.)
    metadatos JSON DEFAULT NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    FOREIGN KEY (lead_uuid) REFERENCES tbl_leads(uuid) ON DELETE CASCADE,
    
    -- Constraint único por lead y empresa
    UNIQUE KEY uk_lead_empresa (lead_uuid, codigo_empresa),
    
    -- Índices
    INDEX idx_ultimo_mensaje (fecha_hora_ultimo_msj),
    INDEX idx_lead (lead_uuid)
);

-- 12. Tabla RESUMEN DE CONTEXTO (Datos Estructurados Extraídos)
-- ================================================================
-- Almacena información estructurada extraída del contexto de la conversación.
-- Evita re-procesar mensajes antiguos y reduce tokens enviados al LLM.
-- Cada vez que la IA extrae datos importantes, se actualizan aquí.
-- ================================================================
CREATE TABLE tbl_contexto_lead (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Relación con lead
    lead_uuid VARCHAR(36) NOT NULL,
    codigo_empresa INT NOT NULL,
    
    -- Datos extraídos de la conversación (actualizados dinámicamente)
    nombre_completo VARCHAR(200),
    presupuesto_min DECIMAL(10,2),
    presupuesto_max DECIMAL(10,2),
    tipo_inmueble VARCHAR(100), -- 'departamento', 'casa', 'terreno', etc.
    num_dormitorios INT,
    num_banos INT,
    ubicacion_preferida VARCHAR(200),
    
    -- Datos de cita solicitada
    fecha_cita_solicitada DATE,
    hora_cita_solicitada TIME,
    tipo_cita VARCHAR(20), -- 'presencial', 'virtual'
    observaciones_cita TEXT,
    
    -- Estado de cualificación
    urgencia VARCHAR(20) DEFAULT 'media', -- 'alta', 'media', 'baja'
    probabilidad_cierre INT DEFAULT 50, -- 0-100
    etapa_embudo VARCHAR(50) DEFAULT 'contacto_inicial', -- 'contacto_inicial', 'interesado', 'calificado', 'negociacion', 'cierre'
    
    -- Proyectos de interés (JSON array de códigos)
    proyectos_interes JSON DEFAULT NULL,
    
    -- Resumen generado por IA (opcional, para referencia humana)
    resumen_conversacion TEXT,
    
    -- Timestamps
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Índices
    UNIQUE KEY uk_lead_empresa (lead_uuid, codigo_empresa),
    INDEX idx_urgencia (urgencia),
    INDEX idx_etapa (etapa_embudo),
    
    -- Foreign Keys
    FOREIGN KEY (lead_uuid) REFERENCES tbl_leads(uuid) ON DELETE CASCADE
);

-- ================================================================
-- TRIGGERS PARA GESTIÓN AUTOMÁTICA DE SESIONES
-- ================================================================

-- TRIGGER 1: Actualizar sesión cuando se inserta mensaje en historial
-- ================================================================
DELIMITER $$

CREATE TRIGGER trg_actualizar_sesion_after_insert_historial
AFTER INSERT ON tbl_historial_chat_ai
FOR EACH ROW
BEGIN
    DECLARE v_min_tiempo INT DEFAULT 60;
    
    -- Intentar actualizar sesión existente
    UPDATE tbl_sesion_conversacion
    SET fecha_hora_ultimo_msj = NEW.created_at,
        updated_at = CURRENT_TIMESTAMP
    WHERE lead_uuid = NEW.lead_uuid 
      AND codigo_empresa = NEW.codigo_empresa;
    
    -- Si no existe la sesión, crearla
    IF ROW_COUNT() = 0 THEN
        INSERT INTO tbl_sesion_conversacion (
            lead_uuid,
            codigo_empresa,
            id_msj_inicio,
            fecha_hora_ultimo_msj,
            proximo_mensaje_minutos,
            metadatos,
            created_at
        )
        VALUES (
            NEW.lead_uuid,
            NEW.codigo_empresa,
            NEW.id,
            NEW.created_at,
            v_min_tiempo,
            NEW.metadatos,
            NEW.created_at
        );
    END IF;
END$$

DELIMITER ;

-- TRIGGER 2: Actualizar timestamp en tbl_leads cuando hay actividad
-- ================================================================
-- Este trigger sincroniza la actividad del chat AI con la tabla de leads
DELIMITER $$

CREATE TRIGGER trg_sync_lead_timestamp
AFTER INSERT ON tbl_historial_chat_ai
FOR EACH ROW
BEGIN
    -- Solo actualizar si es un mensaje del usuario o asistente (no system/function)
    IF NEW.role IN ('user', 'assistant') THEN
        -- Actualizar el timestamp del lead para indicar actividad reciente
        UPDATE tbl_leads
        SET fecha_actualizacion = NEW.created_at
        WHERE uuid = NEW.lead_uuid
          AND codigo_empresa = NEW.codigo_empresa;
    END IF;
END$$
DELIMITER ;

-- 13. Tabla de BOTS (Configuración de Identidad)
-- ================================================================
CREATE TABLE tbl_bots (
    id_bot INT AUTO_INCREMENT PRIMARY KEY,
    codigo_bot VARCHAR(50) NOT NULL UNIQUE, -- Identificador único (ej: b9d4706fc1-nova)
    codigo_empresa INT NOT NULL,
    
    nombre VARCHAR(100) NOT NULL, -- Ej: Checor Advisor
    genero VARCHAR(20) DEFAULT 'neutro', -- masculino, femenino, neutro
    tipo_atencion VARCHAR(50) DEFAULT 'inbound/outbound',
    
    codigo_canal VARCHAR(50) DEFAULT 'whatsapp',
    codigo_credencial VARCHAR(100) DEFAULT NULL, -- UUID o referencia externa
    
    habilitado TINYINT DEFAULT 1,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_bot_empresa (codigo_bot, codigo_empresa),
    INDEX idx_empresa_habilitado (codigo_empresa, habilitado)
);

-- Datos Iniciales (Seed)
INSERT INTO tbl_bots (id_bot, codigo_bot, codigo_empresa, nombre, genero, tipo_atencion, codigo_canal, codigo_credencial, habilitado)
VALUES (1, 'b9d4706fc1-nova', 1, 'Checor Advisor', 'neutro', 'inbound/outbound', 'whatsapp', '124e3a54-1ee7-4cf3-a32e-1ddf2e605860', 1)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), codigo_credencial = VALUES(codigo_credencial);


CREATE TABLE tbl_preguntas_frecuentes (
    id_pregunta INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    uuid VARCHAR(36) NOT NULL DEFAULT (UUID()), -- Genera UUID automático si la versión de MySQL lo soporta, sino enviar desde backend
    id_proyecto INT NOT NULL,
    tipo VARCHAR(50) NOT NULL COMMENT 'Pregunta Frecuente u Objeción Frecuente',
    tema VARCHAR(100) DEFAULT NULL,
    pregunta TEXT NOT NULL,
    respuesta TEXT,
    orden INT DEFAULT 0,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO tbl_preguntas_frecuentes (uuid, id_proyecto, tipo, tema, orden, pregunta, respuesta) VALUES 
-- Preguntas Frecuentes
(UUID(), 1, 'Pregunta Frecuente', 'Ubicación', 1, '¿Donde se encuentra ubicado el proyecto Los Lirios?', 'Av. Petit Thouars 1737, Lince'),
(UUID(), 1, 'Pregunta Frecuente', 'Departamentos', 2, '¿Qué tipos de departamentos ofrece?', 'Tenemos flats y dúplex'),
(UUID(), 1, 'Pregunta Frecuente', 'Ubicación', 3, '¿Qué servicios cercanos hay (supermercados, bancos, colegios, parques)?', 'Está rodeado de tiendas, restaurantes, bancos y servicios esenciales. A pocos minutos se encuentran el Parque Castilla y el Parque del Bombero. En la zona destacan colegios como Saco Oliveros, Christa McAuliffe y Santa Rosa de Lima.'),
(UUID(), 1, 'Pregunta Frecuente', 'Inversión', 4, '¿Cómo es la valorización de la zona? ¿Los departamentos en Lince se revalorizan rápido?', 'Lince es uno de los distritos con mayor demanda por su cercanía a San Isidro. Los departamentos suelen revalorizarse bien, sobre todo en zonas cercanas a avenidas principales como Petit Thouars. La zona atrae inversión inmobiliaria constante.'),
(UUID(), 1, 'Pregunta Frecuente', 'Áreas Comunes', 5, '¿Cuales son sus áreas comunes?', 'Lobby, coworking, gym, bike parking, sala lounge y terraza'),
(UUID(), 1, 'Pregunta Frecuente', 'Acabados', 6, '¿Cuál es el tipo de acabados que tendrá el departamento?', NULL), 
(UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 7, '¿Cuotas mensuales de los departamentos?', 'Cuota de 1 dormitorio desde 1460 soles y cuota de 2 dormitorios desde 2255 soles'),
(UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 8, '¿Cuentan con desembolso postergado?', 'No contamos con desembolso postergado'),
(UUID(), 1, 'Pregunta Frecuente', 'Entrega', 9, '¿Cual es su fecha de entrega?', 'Su fecha de entrega es en diciembre 2026'),
(UUID(), 1, 'Pregunta Frecuente', 'Proyecto', 10, '¿Cuántos pisos y departamentos tiene el proyecto?', 'Tiene 17 pisos y 95 departamentos'),
(UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 11, '¿Cuál es el precio total del departamento?', 'Departamentos de 1 dormitorio con precio desde 291,000 soles y departamentos de 2 dormitorios precio desde 339,000 soles'),
(UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 12, '¿Cuánto es la separación?', 'Se puede separar con 1500 soles'),
(UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 13, '¿Qué bancos trabajan con el proyecto?', 'Se puede financiar con el banco BCP'),
(UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 14, '¿Puedo financiar directamente con la inmobiliaria?', 'Sí contamos con la modalidad de crédito directo. ¿Te gustaría agendar una cita para poder conversar sobre las posibilidades de financiamiento que tenemos disponible?'),
(UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 15, '¿Qué requisitos pide el banco para un crédito hipotecario?', 'Debes contar con un historial crediticio y procurar mantener uno bueno: pagar tus tarjetas y/o deudas adicionales en la fecha de pago, no sobreendeudarte, poder sustentar ingresos suficientes.'),
(UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 16, '¿El proyecto aplica al Bono del Buen Pagador o al Nuevo Crédito Mivivienda?', 'Sí, el proyecto aplica al Bono del Buen Pagador y al Nuevo Crédito Mivivienda. Esto permite acceder a cuotas más accesibles y tasas preferenciales.'),
(UUID(), 1, 'Pregunta Frecuente', 'Entrega', 17, '¿Es entrega inmediata?', 'No, el proyecto se encuentra a punto de iniciar obra.'),
(UUID(), 1, 'Pregunta Frecuente', 'Departamentos', 18, '¿Cuántos dormitorios tiene?', 'El proyecto cuenta con departamentos flat de 1 y 2 dormitorios y dúplex de 3 dormitorios.'),
(UUID(), 1, 'Pregunta Frecuente', 'Obra', 19, '¿Ya inició obra?', 'No, el proyecto iniciará obra a inicios de diciembre.'),

-- Objeciones Frecuentes
(UUID(), 1, 'Objeción Frecuente', 'Obra', 1, 'No han inciado obra aún', 'Iniciaremos obra a inicios de diciembre 2025.'),
(UUID(), 1, 'Objeción Frecuente', 'Departamentos', 2, 'Los departamentos de 1 dorm son muy chicos', 'Tenemos un proyecto muy cercano a Lirios con depas de 1 dorm desde 40m2');