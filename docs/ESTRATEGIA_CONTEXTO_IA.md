# 🧠 ESTRATEGIA DE GESTIÓN DE CONTEXTO PARA IA CON LANGCHAIN

## 📋 **Índice**
1. [Visión General](#visión-general)
2. [Arquitectura de Datos](#arquitectura-de-datos)
3. [Flujo de Procesamiento](#flujo-de-procesamiento)
4. [Optimización de Tokens](#optimización-de-tokens)
5. [Implementación en NestJS](#implementación-en-nestjs)
6. [Casos de Uso](#casos-de-uso)

---

## 🎯 Visión General

Esta estrategia optimiza el **contexto de conversación con IA** para minimizar costos de tokens mientras maximiza la calidad de las respuestas. Se basa en tres principios:

1. **Historial Comprimido**: Solo se envían los últimos 12 mensajes al LLM
2. **Extracción de Datos**: La IA extrae información estructurada importante
3. **Normalización**: Los datos extraídos se guardan en tablas normalizadas

### 🔄 Diferencias con el Proyecto Express Actual

| Aspecto | Proyecto Express (Actual) | Backend NestJS (Nuevo) |
|---------|--------------------------|------------------------|
| **Storage Primario** | Redis + MySQL | MySQL + Redis (cache) |
| **Contexto** | Últimos N mensajes en Redis | Últimos 12 en MySQL, cache en Redis |
| **Extracción** | Metadatos en JSON | Tabla normalizada `tbl_contexto_lead` |
| **Framework IA** | OpenAI SDK directo | LangChain |
| **Recuperación** | Sistema de plantillas | LangChain + Structured Outputs |

---

## 🗄️ Arquitectura de Datos

### Tabla 1: `tbl_historial_chat_ai`

**Propósito**: Almacenar el historial completo de mensajes de conversación.

```sql
CREATE TABLE tbl_historial_chat_ai (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_conversacion VARCHAR(100) NOT NULL,  -- "leadUuid:codigoEmpresa"
    input JSON NOT NULL,                     -- Mensaje LangChain format
    role VARCHAR(20) NOT NULL,               -- 'user', 'assistant', 'system', 'function'
    tkn_input INT DEFAULT 0,
    tkn_output INT DEFAULT 0,
    nombre_modelo VARCHAR(50),
    metadatos JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_conversacion (id_conversacion),
    INDEX idx_conversacion_role (id_conversacion, role)
);
```

**Estructura del campo `input` (compatible con LangChain):**

```json
{
  "role": "user",
  "content": "Hola, busco un departamento de 3 dormitorios",
  "type": "human",
  "name": "Juan Pérez"
}
```

```json
{
  "role": "assistant",
  "content": "¡Perfecto! Te puedo ayudar con eso. ¿Cuál es tu presupuesto aproximado?",
  "type": "ai",
  "tool_calls": null
}
```

**Estructura del campo `metadatos`:**

```json
{
  "codigoEmpresa": 100,
  "celular": "51987654321",
  "codigoPersona": 1234,
  "waId": "51987654321",
  "canal": 2,
  "codigosProyectosInteres": [10, 15],
  "datosExtraidos": {
    "nombre": "Juan Pérez",
    "presupuesto": 250000,
    "tipoInmueble": "departamento",
    "numDormitorios": 3,
    "fechaCitaSolicitada": "2026-02-15",
    "horaCitaSolicitada": "15:00",
    "tipoCita": "presencial",
    "urgencia": "alta"
  }
}
```

---

### Tabla 2: `tbl_sesion_conversacion`

**Propósito**: Gestionar sesiones activas y detectar inactividad para recuperación.

```sql
CREATE TABLE tbl_sesion_conversacion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_conversacion VARCHAR(100) NOT NULL UNIQUE,
    id_msj_inicio INT,
    fecha_hora_ultimo_msj TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    proximo_mensaje_minutos INT DEFAULT 60,
    metadatos JSON DEFAULT NULL,
    
    INDEX idx_ultimo_mensaje (fecha_hora_ultimo_msj)
);
```

**Uso**: 
- Se actualiza automáticamente con un **trigger** cuando se inserta un mensaje
- Permite detectar conversaciones inactivas para enviar mensajes de recuperación
- El campo `proximo_mensaje_minutos` se obtiene de `tbl_plantillas_recuperacion_wapi`

---

### Tabla 3: `tbl_contexto_lead` (NUEVA - Datos Normalizados)

**Propósito**: Almacenar datos estructurados extraídos de la conversación.

```sql
CREATE TABLE tbl_contexto_lead (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lead_uuid VARCHAR(36) NOT NULL,
    codigo_empresa INT NOT NULL,
    
    -- Datos extraídos
    nombre_completo VARCHAR(200),
    presupuesto_min DECIMAL(10,2),
    presupuesto_max DECIMAL(10,2),
    tipo_inmueble VARCHAR(100),
    num_dormitorios INT,
    ubicacion_preferida VARCHAR(200),
    
    -- Datos de cita
    fecha_cita_solicitada DATE,
    hora_cita_solicitada TIME,
    tipo_cita VARCHAR(20),
    observaciones_cita TEXT,
    
    -- Cualificación
    urgencia VARCHAR(20) DEFAULT 'media',
    probabilidad_cierre INT DEFAULT 50,
    etapa_embudo VARCHAR(50) DEFAULT 'contacto_inicial',
    
    proyectos_interes JSON,
    resumen_conversacion TEXT,
    
    UNIQUE KEY uk_lead_empresa (lead_uuid, codigo_empresa),
    FOREIGN KEY (lead_uuid) REFERENCES tbl_leads(uuid) ON DELETE CASCADE
);
```

---

## 🔄 Flujo de Procesamiento

### 1️⃣ **Recepción de Mensaje (Usuario)**

```typescript
// 1. Llega mensaje de WhatsApp
async processIncomingMessage(mensaje: string, leadUuid: string, codigoEmpresa: number) {
  
  // 2. Guardar mensaje del usuario en historial
  await this.guardarMensajeHistorial({
    id_conversacion: `${leadUuid}:${codigoEmpresa}`,
    input: {
      role: 'user',
      content: mensaje,
      type: 'human'
    },
    role: 'user',
    metadatos: {
      codigoEmpresa,
      celular: this.obtenerCelular(leadUuid),
      waId: this.obtenerWaId(leadUuid)
    }
  });
  
  // 3. Obtener últimos 12 mensajes del historial
  const historial = await this.obtenerUltimosMensajes(leadUuid, codigoEmpresa, 12);
  
  // 4. Obtener contexto estructurado (si existe)
  const contexto = await this.obtenerContextoLead(leadUuid, codigoEmpresa);
  
  // 5. Construir prompt enriquecido
  const systemPrompt = await this.construirSystemPrompt(contexto);
  
  // 6. Generar respuesta con LangChain
  const respuesta = await this.generarRespuestaIA(historial, systemPrompt);
  
  // 7. Guardar respuesta de la IA
  await this.guardarMensajeHistorial({
    id_conversacion: `${leadUuid}:${codigoEmpresa}`,
    input: {
      role: 'assistant',
      content: respuesta.contenido,
      type: 'ai'
    },
    role: 'assistant',
    tkn_input: respuesta.tokensInput,
    tkn_output: respuesta.tokensOutput
  });
  
  // 8. Extraer y guardar datos estructurados
  await this.extraerYGuardarContexto(respuesta, leadUuid, codigoEmpresa);
  
  // 9. Enviar respuesta por WhatsApp
  return respuesta.contenido;
}
```

---

### 2️⃣ **Extracción de Datos Estructurados**

La IA debe extraer información importante en cada interacción. Usamos **LangChain Structured Outputs**:

```typescript
import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';

// Schema de extracción
const ContextoExtraidoSchema = z.object({
  nombre: z.string().optional(),
  presupuestoMin: z.number().optional(),
  presupuestoMax: z.number().optional(),
  tipoInmueble: z.enum(['departamento', 'casa', 'terreno', 'local_comercial']).optional(),
  numDormitorios: z.number().optional(),
  ubicacionPreferida: z.string().optional(),
  fechaCitaSolicitada: z.string().optional(), // ISO date
  horaCitaSolicitada: z.string().optional(),
  tipoCita: z.enum(['presencial', 'virtual']).optional(),
  urgencia: z.enum(['alta', 'media', 'baja']).optional(),
  etapaEmbudo: z.enum(['contacto_inicial', 'interesado', 'calificado', 'negociacion', 'cierre']).optional()
});

async extraerContextoDesdeMensajes(historial: BaseMessage[]) {
  const llm = new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0
  });
  
  const llmConEstructura = llm.withStructuredOutput(ContextoExtraidoSchema);
  
  const systemPrompt = `Analiza la siguiente conversación y extrae SOLO la información que está claramente mencionada.
No inventes datos. Si el usuario no mencionó algo, déjalo como undefined.`;
  
  const resultado = await llmConEstructura.invoke([
    new SystemMessage(systemPrompt),
    ...historial
  ]);
  
  return resultado;
}

async guardarContextoExtractado(datosExtraidos: any, leadUuid: string, codigoEmpresa: number) {
  // Upsert en tbl_contexto_lead
  await this.db.query(`
    INSERT INTO tbl_contexto_lead (
      lead_uuid, codigo_empresa, nombre_completo, presupuesto_min, 
      presupuesto_max, tipo_inmueble, num_dormitorios, ubicacion_preferida,
      fecha_cita_solicitada, hora_cita_solicitada, tipo_cita, urgencia, etapa_embudo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      nombre_completo = COALESCE(VALUES(nombre_completo), nombre_completo),
      presupuesto_min = COALESCE(VALUES(presupuesto_min), presupuesto_min),
      presupuesto_max = COALESCE(VALUES(presupuesto_max), presupuesto_max),
      tipo_inmueble = COALESCE(VALUES(tipo_inmueble), tipo_inmueble),
      num_dormitorios = COALESCE(VALUES(num_dormitorios), num_dormitorios),
      ubicacion_preferida = COALESCE(VALUES(ubicacion_preferida), ubicacion_preferida),
      fecha_cita_solicitada = COALESCE(VALUES(fecha_cita_solicitada), fecha_cita_solicitada),
      hora_cita_solicitada = COALESCE(VALUES(hora_cita_solicitada), hora_cita_solicitada),
      tipo_cita = COALESCE(VALUES(tipo_cita), tipo_cita),
      urgencia = COALESCE(VALUES(urgencia), urgencia),
      etapa_embudo = COALESCE(VALUES(etapa_embudo), etapa_embudo),
      fecha_actualizacion = CURRENT_TIMESTAMP
  `, [
    leadUuid, codigoEmpresa, datosExtraidos.nombre, 
    datosExtraidos.presupuestoMin, datosExtraidos.presupuestoMax,
    datosExtraidos.tipoInmueble, datosExtraidos.numDormitorios,
    datosExtraidos.ubicacionPreferida, datosExtraidos.fechaCitaSolicitada,
    datosExtraidos.horaCitaSolicitada, datosExtraidos.tipoCita,
    datosExtraidos.urgencia, datosExtraidos.etapaEmbudo
  ]);
}
```

---

### 3️⃣ **Construcción del System Prompt Enriquecido**

El system prompt debe incluir el contexto estructurado para que la IA tenga memoria:

```typescript
async construirSystemPrompt(leadUuid: string, codigoEmpresa: number): Promise<string> {
  // Obtener contexto guardado
  const contexto = await this.obtenerContextoLead(leadUuid, codigoEmpresa);
  
  // Obtener información de proyectos disponibles
  const proyectos = await this.obtenerProyectosDisponibles(codigoEmpresa);
  
  let prompt = `Eres Sofía, asesora inmobiliaria de Checor. Tu objetivo es ayudar al cliente a encontrar su inmueble ideal y agendar una cita.

## INFORMACIÓN DEL CLIENTE (Contexto Guardado):
`;

  if (contexto) {
    prompt += `
- Nombre: ${contexto.nombre_completo || 'No proporcionado'}
- Presupuesto: ${contexto.presupuesto_min ? `$${contexto.presupuesto_min} - $${contexto.presupuesto_max}` : 'No especificado'}
- Tipo de inmueble: ${contexto.tipo_inmueble || 'No especificado'}
- Dormitorios: ${contexto.num_dormitorios || 'No especificado'}
- Ubicación preferida: ${contexto.ubicacion_preferida || 'No especificada'}
- Urgencia: ${contexto.urgencia || 'media'}
- Etapa: ${contexto.etapa_embudo || 'contacto_inicial'}
`;

    if (contexto.fecha_cita_solicitada) {
      prompt += `
- ⚠️ CITA SOLICITADA: ${contexto.fecha_cita_solicitada} a las ${contexto.hora_cita_solicitada} (${contexto.tipo_cita})
`;
    }
  }

  prompt += `

## PROYECTOS DISPONIBLES:
${proyectos.map(p => `
- ${p.nombre}: ${p.num_dormitorios} dorm, ${p.ubicacion}, desde $${p.precio_desde}
`).join('')}

## INSTRUCCIONES:
1. Si ya tienes información del cliente, úsala para personalizar tu respuesta
2. Si el cliente solicita una cita, usa la herramienta "agendarCita"
3. Siempre sé empática y ayuda al cliente a encontrar lo que busca
4. Si falta información clave (presupuesto, tipo de inmueble), pregúntala de forma natural
`;

  return prompt;
}
```

---

## 📊 Optimización de Tokens

### Estrategia de Ventana Deslizante (Sliding Window)

Solo enviamos los **últimos 12 mensajes** al LLM para reducir costos:

```typescript
async obtenerUltimosMensajes(
  leadUuid: string, 
  codigoEmpresa: number, 
  limite: number = 12,
  omitirFunciones: boolean = false
): Promise<BaseMessage[]> {
  
  const idConversacion = `${leadUuid}:${codigoEmpresa}`;
  
  // Query optimizado con índices
  let query = `
    SELECT input FROM tbl_historial_chat_ai
    WHERE id_conversacion = ?
  `;
  
  if (omitirFunciones) {
    query += ` AND role != 'function'`;
  }
  
  query += `
    ORDER BY id DESC
    LIMIT ?
  `;
  
  const mensajes = await this.db.query(query, [idConversacion, limite]);
  
  // Revertir orden (cronológico)
  return mensajes.reverse().map(m => this.convertirABaseMessage(m.input));
}

convertirABaseMessage(input: any): BaseMessage {
  switch(input.role) {
    case 'user':
      return new HumanMessage(input.content);
    case 'assistant':
      return new AIMessage(input.content);
    case 'system':
      return new SystemMessage(input.content);
    case 'function':
      return new ToolMessage({ content: input.content, tool_call_id: input.id });
    default:
      throw new Error(`Rol desconocido: ${input.role}`);
  }
}
```

### Ahorro de Tokens Estimado

| Estrategia | Tokens Promedio/Mensaje | Mensajes | Total Tokens |
|-----------|-------------------------|----------|--------------|
| **Sin optimización** (todos los mensajes) | 50 | 100 | 5,000 |
| **Con ventana de 12** | 50 | 12 | 600 |
| **Ahorro** | - | - | **88%** 💰 |

---

## 🛠️ Implementación en NestJS

### Service: `HistorialChatService`

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

@Injectable()
export class HistorialChatService {
  
  async guardarMensaje(data: {
    idConversacion: string;
    mensaje: BaseMessage;
    role: string;
    tknInput?: number;
    tknOutput?: number;
    nombreModelo?: string;
    metadatos?: any;
  }) {
    await this.db.query(`
      INSERT INTO tbl_historial_chat_ai 
      (id_conversacion, input, role, tkn_input, tkn_output, nombre_modelo, metadatos)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      data.idConversacion,
      JSON.stringify(this.messageToJSON(data.mensaje)),
      data.role,
      data.tknInput || 0,
      data.tknOutput || 0,
      data.nombreModelo || 'gpt-4o-mini',
      JSON.stringify(data.metadatos || {})
    ]);
  }
  
  async obtenerHistorial(leadUuid: string, codigoEmpresa: number, limite: number = 12) {
    const mensajes = await this.obtenerUltimosMensajes(leadUuid, codigoEmpresa, limite);
    return mensajes;
  }
  
  private messageToJSON(message: BaseMessage) {
    return {
      role: message._getType(),
      content: message.content,
      type: message._getType(),
      additional_kwargs: message.additional_kwargs
    };
  }
}
```

### Service: `ContextoLeadService`

```typescript
@Injectable()
export class ContextoLeadService {
  
  async obtenerContexto(leadUuid: string, codigoEmpresa: number) {
    const [result] = await this.db.query(`
      SELECT * FROM tbl_contexto_lead
      WHERE lead_uuid = ? AND codigo_empresa = ?
    `, [leadUuid, codigoEmpresa]);
    
    return result || null;
  }
  
  async actualizarContexto(leadUuid: string, codigoEmpresa: number, datosExtraidos: any) {
    // Implementación del UPSERT mostrada anteriormente
  }
  
  async obtenerLeadsUrgentes(codigoEmpresa: number) {
    return await this.db.query(`
      SELECT l.*, c.*
      FROM tbl_contexto_lead c
      JOIN tbl_leads l ON c.lead_uuid = l.uuid
      WHERE c.codigo_empresa = ?
        AND c.urgencia = 'alta'
        AND c.fecha_cita_solicitada IS NOT NULL
      ORDER BY c.fecha_actualizacion DESC
    `, [codigoEmpresa]);
  }
}
```

---

## 📈 Casos de Uso

### 1. **Agendar Cita Automáticamente**

Cuando el usuario menciona que quiere una cita:

```
Usuario: "Me gustaría ver el departamento mañana a las 3pm"

IA procesa → Extrae:
- fecha_cita_solicitada: "2026-01-27"
- hora_cita_solicitada: "15:00"
- tipo_cita: "presencial"

Guarda en tbl_contexto_lead → Llama a herramienta agendarCita
```

### 2. **Recuperación de Lead Inactivo**

Cada hora, un job revisa `tbl_sesion_conversacion`:

```typescript
async recuperarLeadsInactivos() {
  const sesionesInactivas = await this.db.query(`
    SELECT sc.*, cl.urgencia, cl.nombre_completo
    FROM tbl_sesion_conversacion sc
    LEFT JOIN tbl_contexto_lead cl ON sc.id_conversacion = CONCAT(cl.lead_uuid, ':', cl.codigo_empresa)
    WHERE TIMESTAMPDIFF(MINUTE, sc.fecha_hora_ultimo_msj, NOW()) >= sc.proximo_mensaje_minutos
      AND NOT EXISTS (
        SELECT 1 FROM tbl_mensajes_recuperacion_enviados 
        WHERE id_conversacion = sc.id_conversacion 
          AND estado = 'enviado'
          AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      )
  `);
  
  for (const sesion of sesionesInactivas) {
    // Obtener últimos 12 mensajes
    const historial = await this.obtenerHistorial(sesion.lead_uuid, sesion.codigo_empresa, 12);
    
    // Generar mensaje de recuperación con IA
    const mensajeRecuperacion = await this.generarMensajeRecuperacion(historial, sesion.urgencia);
    
    // Enviar por WhatsApp
    await this.enviarWhatsApp(sesion.celular, mensajeRecuperacion);
  }
}
```

### 3. **Dashboard de Cualificación**

Mostrar leads por etapa del embudo:

```typescript
async getLeadsPorEtapa(codigoEmpresa: number) {
  return await this.db.query(`
    SELECT 
      etapa_embudo,
      COUNT(*) as cantidad,
      AVG(probabilidad_cierre) as prob_promedio,
      SUM(CASE WHEN urgencia = 'alta' THEN 1 ELSE 0 END) as urgentes
    FROM tbl_contexto_lead
    WHERE codigo_empresa = ?
    GROUP BY etapa_embudo
  `, [codigoEmpresa]);
}
```

---

## 🚀 Mejoras sobre el Proyecto Express

1. **✅ Normalización de Datos**: Menos redundancia, queries más rápidas
2. **✅ Compatibilidad LangChain**: Uso de `BaseMessage` nativo
3. **✅ Extracción Estructurada**: Datos útiles para reportes y dashboard
4. **✅ Optimización de Tokens**: Ahorro del 88% en costos de IA
5. **✅ TypeScript**: Tipado fuerte, menos errores en producción
6. **✅ Escalabilidad**: Índices optimizados, arquitectura modular

---

## 📝 Próximos Pasos

1. Crear entidades TypeORM para las nuevas tablas
2. Implementar servicios de historial y contexto
3. Crear decoradores para tracking automático de tokens
4. Implementar job de recuperación de leads
5. Crear dashboard de análisis de conversaciones

---

**Autor**: Sistema de IA - Backend NestJS Checor  
**Fecha**: 26 de Enero de 2026  
**Versión**: 1.0
