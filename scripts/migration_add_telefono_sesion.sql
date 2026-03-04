-- Migración: Agregar numero_telefono a tbl_sesion_conversacion
-- Fecha: 2026-03-03

-- 1. Agregar la columna numero_telefono a la tabla tbl_sesion_conversacion
ALTER TABLE tbl_sesion_conversacion
ADD COLUMN numero_telefono VARCHAR(20) AFTER codigo_empresa;

-- 2. Población inicial de la columna con datos existentes de tbl_leads
-- 2. Población inicial de la columna con datos existentes de tbl_leads
UPDATE tbl_sesion_conversacion sc
JOIN tbl_leads l ON sc.lead_uuid = l.uuid
SET sc.numero_telefono = l.telefono_principal
WHERE sc.codigo_empresa = l.codigo_empresa;

-- 3. Actualizar el trigger trg_actualizar_sesion_after_insert_historial para que siga insertando el numero_telefono
DELIMITER $$

DROP TRIGGER IF EXISTS trg_actualizar_sesion_after_insert_historial$$

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
        -- Obtener el numero_telefono desde tbl_leads
        SELECT telefono_principal INTO @telefono_lead 
        FROM tbl_leads 
        WHERE uuid = NEW.lead_uuid AND codigo_empresa = NEW.codigo_empresa LIMIT 1;
        
        INSERT INTO tbl_sesion_conversacion (
            lead_uuid,
            codigo_empresa,
            numero_telefono,
            id_msj_inicio,
            fecha_hora_ultimo_msj,
            proximo_mensaje_minutos,
            metadatos,
            created_at
        )
        VALUES (
            NEW.lead_uuid,
            NEW.codigo_empresa,
            IFNULL(@telefono_lead, ''),
            NEW.id,
            NEW.created_at,
            v_min_tiempo,
            NEW.metadatos,
            NEW.created_at
        );
    END IF;
END$$

DELIMITER;