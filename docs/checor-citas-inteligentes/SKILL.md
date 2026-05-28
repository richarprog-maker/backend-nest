---
name: checor-citas-inteligentes
description: Avance y reglas de implementacion para la historia de usuario de notificacion y asignacion inteligente de citas en Checor. Usar al continuar tareas de citas, leads calientes, asesores, proyectos, campanias o notificaciones por correo y WhatsApp.
---

# Checor Citas Inteligentes

## Alcance

Implementar la historia de usuario de notificacion y asignacion inteligente de citas por etapas, respetando arquitectura limpia y cambios acotados.

## Reglas del proyecto

- No hardcodear credenciales ni datos de asesores.
- Mantener valores configurables en `.env`, constantes o parametros.
- Respetar asesores activos antes de notificar.
- Mantener asignaciones existentes del CRM cuando se agregue el modelo de asignacion.
- No cambiar flujos de campanias, CRM o backoffice fuera de la etapa activa.

## Avance actual

- Hecho: modulo backend `NotificacionesCitasModule`.
- Hecho: servicio `NotificacionesCitasService` para correo con Gmail SMTP usando `EMAIL_NOTIFICATIONS`, `EMAIL_APP_PASSWORD` y `EMAIL_SSL_VERIFY`.
- Hecho: envio WhatsApp al telefono del asesor usando `WapiService`.
- Hecho: notificacion disparada solo cuando `agendarCita` clasifica el lead como `alto`.
- Hecho: resolucion inicial de asesor activo por `idVendedor` de la cita o primer responsable activo del proyecto.
- Hecho: tabla `tbl_plantillas_notificaciones_asesores` para configurar mensajes de notificacion a asesores por canal `WHATSAPP` y `EMAIL`.
- Hecho: migracion `scripts/migration_plantillas_notificaciones_asesores.sql` ejecutada con plantillas base para cita de lead caliente.
- Hecho: `NotificacionesCitasService` usa la plantilla activa por canal y cae a mensaje default si no existe configuracion.
- Pendiente: modelo de datos para asesor asignado persistente y origen de asignacion.
- Pendiente: reglas completas para CRM, campanias masivas y campo `Asesor`.
- Pendiente: limitar y validar hasta dos responsables por proyecto en backoffice.
- Pendiente: pantalla/API de backoffice para editar las plantillas de notificacion a asesores.
- Pendiente: configurar `nombre_template_whatsapp` cuando Meta apruebe la plantilla oficial de WhatsApp.
- Pendiente: decidir servidor de correo final con el cliente.

## Datos que faltan del cliente

- Lista de asesores.
- Correos de asesores.
- Telefonos de asesores.
- Codigo de asesor.
- Confirmacion del servidor de correo.
- Plantilla del mensaje para notificacion de cita.

## Siguiente paso recomendado

Agregar migracion y entidades para persistir asesor asignado, codigo de asesor y origen de asignacion antes de ampliar el motor de asignacion.
