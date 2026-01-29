# ✅ IMPLEMENTACIÓN DE HISTORIAL DE CHAT - VERIFICACIÓN

## 🎯 Cambios Implementados

### 1. **Entidad TypeORM**: `HistorialChatAi`
- Archivo: `backend-nest/src/modules/ia/entities/historial-chat-ai.entity.ts`
- Mapea la tabla `tbl_historial_chat_ai`
- Incluye índices optimizados

### 2. **Servicio de Historial**: `HistorialChatService`
- Archivo: `backend-nest/src/modules/ia/historial-chat.service.ts`
- Métodos principales:
  - `guardarMensaje()` - Guarda mensajes en BD
  - `obtenerUltimosMensajes()` - Obtiene últimos N mensajes
  - `obtenerHistorialParaIA()` - Formatea historial para el LLM
  - `obtenerEstadisticasTokens()` - Calcula tokens usados

### 3. **Integración en `AiService`**
- Archivo: `backend-nest/src/modules/ia/ia.service.ts`
- Ahora guarda **automáticamente**:
  - ✅ Mensaje del usuario
  - ✅ Respuesta de la IA
  - ✅ Tool calls (cuando se usan herramientas)
  - ✅ Resultados de herramientas
  - ✅ Respuesta final después de tool execution
  - ✅ Tokens consumidos (input/output)

### 4. **Módulo actualizado**
- Archivo: `backend-nest/src/modules/ia/ia.module.ts`
- Importa `TypeOrmModule.forFeature([HistorialChatAi])`
- Exporta `HistorialChatService`

---

## 🔍 Cómo Verificar que Funciona

### Opción 1: Query SQL Directo

```sql
-- Ver los últimos 20 mensajes guardados
SELECT 
    h.id,
    h.lead_uuid,
    h.codigo_empresa,
    l.nombre,
    l.telefono_principal,
    h.role,
    JSON_UNQUOTE(JSON_EXTRACT(h.input, '$.content')) as contenido,
    h.tkn_input,
    h.tkn_output,
    h.nombre_modelo,
    h.created_at
FROM tbl_historial_chat_ai h
LEFT JOIN tbl_leads l ON h.lead_uuid = l.uuid
ORDER BY h.id DESC
LIMIT 20;
```

### Opción 2: Por Lead Específico

```sql
-- Ver historial de un lead específico
SELECT 
    id,
    role,
    JSON_UNQUOTE(JSON_EXTRACT(input, '$.content')) as contenido,
    created_at
FROM tbl_historial_chat_ai
WHERE lead_uuid = '{TU_LEAD_UUID}'
  AND codigo_empresa = 1
ORDER BY id ASC;
```

### Opción 3: Verificar Sesiones Activas

```sql
-- Ver sesiones activas con última actividad
SELECT 
    sc.id,
    sc.lead_uuid,
    l.nombre,
    l.telefono_principal,
    sc.fecha_hora_ultimo_msj,
    TIMESTAMPDIFF(MINUTE, sc.fecha_hora_ultimo_msj, NOW()) as minutos_inactivo,
    sc.proximo_mensaje_minutos,
    COUNT(h.id) as total_mensajes
FROM tbl_sesion_conversacion sc
LEFT JOIN tbl_leads l ON sc.lead_uuid = l.uuid
LEFT JOIN tbl_historial_chat_ai h ON h.lead_uuid = sc.lead_uuid AND h.codigo_empresa = sc.codigo_empresa
GROUP BY sc.id
ORDER BY sc.fecha_hora_ultimo_msj DESC;
```

### Opción 3: Estadísticas de Tokens

```sql
-- Ver consumo de tokens por lead
SELECT 
    h.lead_uuid,
    l.nombre,
    l.telefono_principal,
    COUNT(*) as total_mensajes,
    SUM(h.tkn_input) as total_tokens_input,
    SUM(h.tkn_output) as total_tokens_output,
    SUM(h.tkn_input + h.tkn_output) as total_tokens
FROM tbl_historial_chat_ai h
LEFT JOIN tbl_leads l ON h.lead_uuid = l.uuid
GROUP BY h.lead_uuid, h.codigo_empresa
ORDER BY total_tokens DESC;
```

### Opción 4: Verificar Triggers Funcionando

```sql
-- Verificar que las sesiones se actualizan automáticamente
SELECT 
    'Historial' as tabla,
    COUNT(*) as registros,
    MAX(created_at) as ultimo_registro
FROM tbl_historial_chat_ai
UNION ALL
SELECT 
    'Sesiones' as tabla,
    COUNT(*) as registros,
    MAX(fecha_hora_ultimo_msj) as ultimo_registro
FROM tbl_sesion_conversacion;
```

---

## 🧪 Prueba Manual

1. **Enviar mensaje por WhatsApp**
   ```
   "Hola, quiero información sobre departamentos"
   ```

2. **Esperar respuesta del bot**

3. **Verificar en BD**
   ```sql
   -- Debe haber al menos 2 registros nuevos:
   -- 1. role = 'user' (tu mensaje)
   -- 2. role = 'assistant' (respuesta del bot)
   
   SELECT 
       h.id,
       h.lead_uuid,
       h.role,
       JSON_UNQUOTE(JSON_EXTRACT(h.input, '$.content')) as contenido,
       h.created_at
   FROM tbl_historial_chat_ai h
   ORDER BY h.id DESC 
   LIMIT 5;
   
   -- Verificar que la sesión se actualizó
   SELECT 
       sc.*,
       TIMESTAMPDIFF(SECOND, sc.fecha_hora_ultimo_msj, NOW()) as segundos_desde_ultimo_msj
   FROM tbl_sesion_conversacion sc
   ORDER BY sc.updated_at DESC
   LIMIT 1;
   ```

4. **Si usaste una herramienta (ej: agendar cita)**
   ```sql
   -- Deberías ver:
   -- 1. role = 'user' (mensaje original)
   -- 2. role = 'assistant' (con tool_calls en metadatos)
   -- 3. role = 'function' (resultado de la herramienta)
   -- 4. role = 'assistant' (respuesta final)
   
   SELECT 
       id, role, 
       JSON_EXTRACT(metadatos, '$.tool_name') as herramienta,
       created_at 
   FROM tbl_historial_chat_ai 
   ORDER BY id DESC LIMIT 10;
   ```

---

## 📊 Ejemplo de Salida Esperada

```
+----+--------------------------------------+------------+----------------------------------+
| id | lead_uuid                            | role       | contenido                        |
+----+--------------------------------------+------------+----------------------------------+
| 15 | 550e8400-e29b-41d4-a716-446655440000 | assistant  | ¡Perfecto! Te puedo ayudar...   |
| 14 | 550e8400-e29b-41d4-a716-446655440000 | user       | Hola, quiero un departamento    |
| 13 | 7c9e6679-7425-40de-944b-e07fc1f90ae7 | function   | {"success": true, "cita_id": 5} |
| 12 | 7c9e6679-7425-40de-944b-e07fc1f90ae7 | assistant  | [tool_call: agendar_cita]       |
| 11 | 7c9e6679-7425-40de-944b-e07fc1f90ae7 | user       | Quiero agendar para mañana      |
+----+--------------------------------------+------------+----------------------------------+
```

### Verificar Sesiones Actualizadas Automáticamente

```
+----+--------------------------------------+-----------------+-------------------------+------------------+
| id | lead_uuid                            | minutos_inactivo| fecha_hora_ultimo_msj   | total_mensajes   |
+----+--------------------------------------+-----------------+-------------------------+------------------+
| 1  | 550e8400-e29b-41d4-a716-446655440000 | 2               | 2026-01-26 10:30:00     | 8                |
| 2  | 7c9e6679-7425-40de-944b-e07fc1f90ae7 | 45              | 2026-01-26 09:45:00     | 12               |
+----+--------------------------------------+-----------------+-------------------------+------------------+
```

---

## 🐛 Troubleshooting

### Problema: No se guardan mensajes

**Verificar:**

1. ¿Las tablas existen en la BD?
   ```sql
   SHOW TABLES LIKE 'tbl_historial_chat_ai';
   SHOW TABLES LIKE 'tbl_sesion_conversacion';
   
   -- Verificar estructura
   DESCRIBE tbl_historial_chat_ai;
   DESCRIBE tbl_sesion_conversacion;
   
   -- Verificar triggers
   SHOW TRIGGERS WHERE `Table` = 'tbl_historial_chat_ai';
   ```

2. ¿Hay errores en los logs de NestJS?
   ```bash
   # Ver logs del contenedor/servicio
   docker logs -f backend-nest
   # o
   npm run start:dev
   ```

3. ¿El módulo está importado correctamente?
   ```bash
   # Verificar que TypeOrmModule incluye HistorialChatAi y SesionConversacion
   cat backend-nest/src/modules/ia/ia.module.ts
   ```

### Problema: Las sesiones no se actualizan automáticamente

**Causa:** Los triggers no están creados.

**Solución:**
```bash
# Verificar triggers
mysql -u root -p db_checorv2 -e "SHOW TRIGGERS WHERE \`Table\` = 'tbl_historial_chat_ai';"

# Si no existen, ejecutar el schema completo
mysql -u root -p db_checorv2 < backend-nest/src/database/schema_full.sql
```

### Problema: Error "Table doesn't exist"

**Solución:**
```bash
# Ejecutar el schema en MySQL
mysql -u root -p db_checorv2 < backend-nest/src/database/schema_full.sql
```

### Problema: JSON parsing errors

**Causa:** La columna `input` debe ser JSON, no TEXT.

**Verificar:**
```sql
DESCRIBE tbl_historial_chat_ai;
-- Campo 'lead_uuid' debe existir con tipo VARCHAR(36)
-- Campo 'codigo_empresa' debe existir con tipo INT
-- Debe tener FK a tbl_leads(uuid)
```

### Problema: Error "Cannot add foreign key constraint"

**Causa:** La tabla `tbl_leads` no existe o no tiene el campo `uuid`.

**Solución:**
```bash
# Ejecutar el schema completo en orden
mysql -u root -p db_checorv2 < backend-nest/src/database/schema_full.sql
```

---

## 🎉 Beneficios Implementados

✅ **Persistencia**: El historial se guarda en MySQL (no solo en Redis)  
✅ **Recuperación**: Si el bot se reinicia, recupera el contexto desde BD  
✅ **Normalización**: Relación directa con `tbl_leads` usando UUID  
✅ **Sesiones Automáticas**: Triggers actualizan `tbl_sesion_conversacion` automáticamente  
✅ **Auditoría**: Puedes ver todas las conversaciones históricas por lead  
✅ **Análisis de Tokens**: Tracking de costos de OpenAI por lead  
✅ **Debugging**: Facilita encontrar errores en conversaciones  
✅ **Reportes**: Datos para dashboards y análisis de calidad  
✅ **Recuperación de Leads**: Detecta inactividad para enviar mensajes automáticos  
✅ **Integridad Referencial**: CASCADE DELETE mantiene consistencia de datos  

---

## 📝 Próximos Pasos Sugeridos

1. Crear endpoint API para ver historial desde el frontend
2. Implementar tabla `tbl_contexto_lead` para datos estructurados
3. Crear job automático para limpiar historial antiguo (>30 días)
4. Dashboard de métricas: tokens usados, conversaciones activas, etc.
5. Implementar extracción automática de datos importantes (nombre, presupuesto, etc.)

---

**Autor**: Sistema de IA  
**Fecha**: 26 de Enero de 2026  
**Status**: ✅ Implementado y Listo para Pruebas
