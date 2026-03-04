
SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE tbl_plantillas_mensajes;

SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO
    tbl_plantillas_mensajes (
        nombre,
        tipo,
        contenido,
        parametros,
        idioma,
        codigo_empresa
    )
VALUES

-- Primer Contacto
(
    'mensaje_primer_contacto2',
    'PRIMER_CONTACTO',
    '¡Hola {{name}} 👋 Soy Checor Advisor, tu asesor de checor Inmobiliaria 😊.\n\n*¡Hemos recibido tu solicitud!* Gracias por interesarte en nuestro PROYECTO {{project}} 🧑💼Para brindarte una mejor atención\n\n¿Cuántos dormitorios buscas para tu nuevo departamento?',
    '["name", "project"]',
    'es_PE',
    1
),

-- Recordatorio Cita 24h Presencial
(
    'recordatorio_cita_24horas2',
    'RECORDATORIO_CITA_24H',
    'Hola {{name}} 👋, te recordamos que mañana tienes tu visita programada al proyecto {{project}} .\n\n🕘 Hora: {{hora}}\n\nNuestro asesor estará esperándote para mostrarte todo lo que este proyecto tiene para ti. 🏠\n\n Si necesitas reprogramar, solo avísanos.',
    '["name", "project", "hora"]',
    'es_PE',
    1
),

-- Recordatorio Cita 3h Presencial
(
    'recordatorio_cita_3horas2',
    'RECORDATORIO_CITA_3H',
    'Hola {{name}}, tu cita en el proyecto {{project}} es hoy a las {{hora}}.\n\n📍{{direccion}}\n\n¡Te esperamos!',
    '["name", "project", "hora", "direccion"]',
    'es_PE',
    1
),

-- Recordatorio Cita 30min Presencial
(
    'recordatorio_cita_30min2',
    'RECORDATORIO_CITA_30MIN',
    '✨ ¡Todo listo para tu visita, {{name}} !\n\nTu cita es en breve. Si necesitas indicaciones, estamos atentos. 😊',
    '["name"]',
    'es_PE',
    1
),

-- Recordatorio Cita 24h Virtual
(
    'recordatorio_cita_24horas_virtual_2',
    'RECORDATORIO_CITA_24H',
    '👋 ¡Hola {{name}}!\n\nTe recordamos que mañana tienes tu cita virtual por el Proyecto {{project}}.\n\n🕘 Hora: {{hora}}\n\nSi tienes alguna duda o necesitas apoyo antes de conectarte estamos atentos para ayudarte.',
    '["name", "project", "hora"]',
    'es_PE',
    1
),

-- Recordatorio Cita 3h Virtual
(
    'recordatorio_cita_3horas_virtual_2',
    'RECORDATORIO_CITA_3H',
    '💻 ¡Recordatorio!\n\nEn solo 3 horas tendrás tu cita virtual para conocer todo sobre el Proyecto {{project}}.\n\nSi necesitas algo antes de conectarte, no dudes en avisarnos.',
    '["project"]',
    'es_PE',
    1
),

-- Recordatorio Cita 30min Virtual
(
    'recordatorio_cita_30min_virtual_2',
    'RECORDATORIO_CITA_30MIN',
    '⏳ ¡Hola {{name}}!\n\nTu cita virtual para conocer el proyecto {{project}}, empieza en 30 minutos. El asesor te compartirá el enlace en breve.',
    '["name", "project"]',
    'es_PE',
    1
),

-- Recuperación 1 hora
(
    'mensaje_recuperacion_1hora_2',
    'RECUPERACION_1H',
    '¡Hola! 👋 Solo quería confirmar si aún estás por aquí.\n\nRecuerda que estoy listo para ayudarte con cualquier duda sobre el proyecto {{project}} para programar una visita cuando gustes. 🏡',
    '["project"]',
    'es_PE',
    1
),

-- Recuperación 8 horas
(
    'mensaje_recuperacion_8horas_2',
    'RECUPERACION_8H',
    '👋 ¡Hola de nuevo! Solo quería recordarte que aún estás a tiempo de separar tu departamento en el proyecto {{project}}.\n\n¿Te gustaría que te comparta más detalles cuando tengas un momento? 🏡✨',
    '["project"]',
    'es_PE',
    1
),

-- Recuperación 24 horas
(
    'mensaje_recuperacion_24horas_2',
    'RECUPERACION_24H',
    '¡Hola! 👋 Quería saber si aún sigues interesado en el proyecto {{project}}, ya que quedan pocas unidades disponibles. Sigo aquí para ayudarte cuando estés listo.',
    '["project"]',
    'es_PE',
    1
);