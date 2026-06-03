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

## Reglas de visibilidad de leads en el inbox

Implementadas en `InboxService.getConversaciones` (líneas 34-60 aprox).

| Caso | Condición | ¿Quién ve el lead? |
|------|-----------|-------------------|
| **1** | `sesion.asesor_id IS NULL` | Todos los vendedores asignados al proyecto del lead |
| **2** | `sesion.asesor_id = N` y asesor **activo** | Solo ese asesor (N). Los demás del proyecto NO lo ven |
| **3** | `sesion.asesor_id = N` y asesor **inactivo** (vacaciones) | Los otros vendedores activos del mismo proyecto SÍ lo ven |
| **Admin** | Cualquier caso | Ve todos los leads sin filtro |

**Fundamento del Caso 3:** cuando un asesor está de vacaciones el lead no queda huérfano.
El sistema lo muestra a los otros responsables activos del proyecto para garantizar continuidad
de atención, sin reasignar permanentemente el lead (cuando el asesor vuelva, el lead
vuelve a ser solo suyo si está activo).

## Flujo de asignacion de asesor (DEFINITIVO)

```
tbl_vendedores (maestro de asesores)
  - id_vendedor          → clave en todo el sistema
  - estado_vendedor      → activo / inactivo (para vacaciones/descanso)
  - sperant_vendedor_id  → ID en Sperant CRM para mapear asignaciones CRM

tbl_sesion_conversacion (fuente de verdad por lead)
  - lead_uuid            → identifica al lead
  - proyecto_id          → proyecto de interés
  - asesor_id            → id_vendedor asignado (CRM, campaña o round-robin)

tbl_campanias
  - asesor_id            → id_vendedor seleccionado al crear la campaña
                           → se propaga a sesion_conversacion al procesar
```

### Prioridad de asignacion en NotificacionesCitasService

1. `sesion_conversacion.asesor_id` activo → usa ese asesor (respeta CRM y campaña)
2. Si asesor inactivo (vacaciones) → escala al siguiente responsable activo del proyecto
3. `cita.id_vendedor` activo → fallback legacy
4. Primer responsable activo de `tbl_vendedores_proyectos` → round-robin base

### Propagacion del asesor por origen

| Origen       | Cómo se asigna asesor_id en sesion_conversacion                          |
|--------------|--------------------------------------------------------------------------|
| CRM          | Al importar leads: buscar vendedor por `sperant_vendedor_id` → asignar   |
| Campaña      | `campania.asesor_id` → `resetearOCrearSesion` → `sesion.asesor_id`       |
| Orgánico     | Round-robin entre responsables activos del proyecto (pendiente)          |
| Manual       | Backoffice puede editar `sesion.asesor_id` directamente (pendiente API)  |

## Avance actual

- Hecho: modulo backend `NotificacionesCitasModule`.
- Hecho: servicio `NotificacionesCitasService` para correo con Gmail SMTP usando `EMAIL_NOTIFICATIONS`, `EMAIL_APP_PASSWORD` y `EMAIL_SSL_VERIFY`.
- Hecho: envio WhatsApp al telefono del asesor usando `WapiService`.
- Hecho: notificacion disparada solo cuando `agendarCita` clasifica el lead como `alto`.
- Hecho: tabla `tbl_plantillas_notificaciones_asesores` para configurar mensajes de notificacion a asesores por canal `WHATSAPP` y `EMAIL`.
- Hecho: migracion `scripts/migration_plantillas_notificaciones_asesores.sql` ejecutada con plantillas base para cita de lead caliente.
- Hecho: `NotificacionesCitasService` usa la plantilla activa por canal y cae a mensaje default si no existe configuracion.
- Hecho: campo `asesor_id` en `tbl_sesion_conversacion` (fuente de verdad de asignacion).
- Hecho: campo `sperant_vendedor_id` en `tbl_vendedores` (mapeo con CRM de Sperant).
- Hecho: campo `asesor_id` en `tbl_campanias` (asesor seleccionado al crear campaña).
- Hecho: `NotificacionesCitasService` lee `sesion_conversacion.asesor_id` con prioridad, filtra asesores inactivos y notifica a todos los responsables activos del proyecto sin duplicados.
- Hecho: `campanias.processor.ts` propaga `campania.asesorId` a `sesion_conversacion` al procesar (NO sobreescribe si ya tenia asesor).
- Hecho: `ProyectosService.asignarVendedor` valida maximo 10 responsables por proyecto.
- Hecho: `AuthService.toggleEstadoVendedor` para activar/desactivar asesor desde backoffice.
- Hecho: endpoint `PUT auth/vendedores/:id/estado` con body `{ estado: 'activo' | 'inactivo' }`.
- Hecho: migraciones SQL en `scripts/migration_asignacion_asesor_lead.sql` y `scripts/migration_campania_asesor.sql`.
- Hecho: importacion Excel de Base de Datos exige `project_id` y `asesor_id`, valida que el asesor pertenezca al proyecto y propaga ambos a `sesion_conversacion`.
- Hecho: la importacion Excel de campanias usa `project_id` y `asesor_id` por fila; al procesar audiencia propaga ambos a `sesion_conversacion`.
- Pendiente: poblar `sesion_conversacion.asesor_id` para leads importados directamente del CRM usando `sperant_vendedor_id`.
- Pendiente: endpoint API para que el backoffice edite `sesion_conversacion.asesor_id` manualmente.
- Pendiente: API CRUD de plantillas de notificacion para backoffice.
- Pendiente: configurar `nombre_template_whatsapp` cuando Meta apruebe la plantilla oficial de WhatsApp.
- Pendiente: decidir servidor de correo final con el cliente.
- Pendiente: ejecutar migraciones SQL en produccion.

## Migraciones SQL pendientes de ejecutar

```
scripts/migration_asignacion_asesor_lead.sql  ← asesor_id en sesion, sperant_vendedor_id en vendedores
scripts/migration_campania_asesor.sql         ← asesor_id en campanias
```

## Datos que faltan del cliente

- Lista de asesores.
- Correos de asesores.
- Telefonos de asesores.
- Codigo de asesor (sperant_vendedor_id).
- Confirmacion del servidor de correo.
- Plantilla del mensaje para notificacion de cita.

## Siguiente paso recomendado

Ejecutar las dos migraciones SQL en la base de datos de staging/produccion.
Luego poblar asignaciones historicas de CRM usando `sperant_vendedor_id`.
