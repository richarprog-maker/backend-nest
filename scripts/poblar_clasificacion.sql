USE db_checorv2;

-- Limpiar los registros actuales por seguridad antes de hacer la inserción masiva
TRUNCATE TABLE tbl_historial_clasificacion_lead;

-- Insertar las clasificaciones recuperadas para todas las sesiones existentes
INSERT INTO
    tbl_historial_clasificacion_lead (
        id_sesion,
        clasificacion,
        razon,
        fecha_creacion
    )
SELECT sc.id AS id_sesion,

-- Lógica de negocio solicitada para definir la temperatura correcta
CASE
    WHEN sc.proximo_mensaje_minutos = 0 THEN 'bajo'
    ELSE 'medio'
END AS clasificacion,

-- Una razón descriptiva para saber que provienen de esta recuperación
'Clasificación automática recuperada' AS razon,

-- Fechas de febrero 2026 forzadas si no caen en ese rango
CASE
    WHEN MONTH(sc.created_at) = 2
    AND YEAR(sc.created_at) = 2026 THEN sc.created_at
    ELSE DATE_ADD(
        '2026-02-01 09:00:00',
        INTERVAL FLOOR(RAND() * 27) DAY
    )
END AS fecha_creacion
FROM tbl_sesion_conversacion sc;

-- ---------------------------------------------------------
-- PASO 2: Actualizar a "alto" a los que ya tienen una cita
-- ---------------------------------------------------------
UPDATE tbl_historial_clasificacion_lead hcl
INNER JOIN tbl_sesion_conversacion sc ON sc.id = hcl.id_sesion
INNER JOIN tbl_citas c ON c.lead_uuid = sc.lead_uuid
SET
    hcl.clasificacion = 'alto',
    hcl.razon = 'Lead agendó una cita presencial/virtual'
WHERE
    hcl.id > 0;