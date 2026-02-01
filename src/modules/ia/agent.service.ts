import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolsExecutionService } from './tools/tools-execution.service';
import { HistorialChatService } from './historial-chat.service';
import { BaseMessage, AIMessage, ToolMessage } from '@langchain/core/messages';

/**
 * 
 * Reemplaza el manual if/else de 9 herramientas con AgentExecutor
 * El agente DECIDE automáticamente qué tool usar y cuándo parar
 * 

 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private llm: ChatOpenAI;
  private tools: DynamicStructuredTool[] = [];

  constructor(
    private configService: ConfigService,
    private toolsExecutionService: ToolsExecutionService,
    private historialChatService: HistorialChatService,
  ) {
    const modelName = this.configService.get<string>('OPENAI_MODEL') || 'o4-mini';
    const isReasoningModel = modelName.includes('o1-') || modelName.includes('o3-') || modelName.includes('o4-') || modelName === 'o4-mini';

    const temperature = isReasoningModel ? 1 : 0.7; // 0.7 para que sea más amigable y creativo (no frío)

    this.logger.log(`Inicializando IA con modelo: ${modelName} (Reasoning: ${isReasoningModel}, Temp: ${temperature})`);

    this.llm = new ChatOpenAI({
      modelName: modelName,
      temperature: temperature,
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });

    // Inicializar tools
    this.initializeTools();
  }

  /**
   * Define las 9 herramientas del agente usando Zod schemas
   * Cada tool es una función que el agente puede llamar
   */
  private initializeTools() {
    // 1️ Agendar Cita
    const agendarCitaTool = new DynamicStructuredTool({
      name: 'agendar_cita',
      description: 'Agenda una cita para visitar un proyecto inmobiliario. Retorna confirmación o error si el horario está ocupado.',
      schema: z.object({
        fecha_cita: z.string().describe('Fecha en formato YYYY-MM-DD'),
        hora_cita: z.string().describe('Hora en formato HH:MM (24h)'),
        nombre_proyecto: z.string().describe('Nombre del proyecto a visitar'),
        tipo_cita: z.enum(['presencial', 'virtual']).describe('Tipo de visita'),
        unidad_interes: z.string().optional().describe('Número de unidad que le interesó (Ej: 1702)'),
        dormitorios: z.number().optional().describe('Cantidad de dormitorios de interés'),
        precio_referencial: z.string().optional().describe('Precio referencial de la unidad'),
        area: z.string().optional().describe('Area de la unidad'),
      }),
      func: async (input, config) => {
        // Metadata se pasa via config.metadata desde AgentExecutor
        const { codigoEmpresa, leadUuid } = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.agendarCita(input, codigoEmpresa, leadUuid);
        return JSON.stringify(result);
      },
    });

    // 2️    Buscar Preguntas Frecuentes (FAQs)
    const buscarPreguntasFrecuentesTool = new DynamicStructuredTool({
      name: 'buscar_preguntas_frecuentes',
      description: 'MOTOR DE INFORMACIÓN: Úsala para CUALQUIER pregunta sobre: Ubicación/Entorno, Financiamiento/Bancos, Acabados, Áreas Comunes, Fechas de Entrega/Obra, Tipos de dpto (general) y Requisitos. Si no encuentras la respuesta aquí, NO la inventes.',
      schema: z.object({
        queries_de_busqueda: z.array(z.string()).describe('Lista de preguntas o palabras clave'),
        nombre_proyecto: z.string().describe('Nombre del proyecto'),
      }),
      func: async (input) => {
        const result = await this.toolsExecutionService.buscarPreguntasFrecuentes(input);
        return result;
      },
    });

    // 3️    Validar DNI
    const validarDniTool = new DynamicStructuredTool({
      name: 'validar_dni',
      description: 'Valida que un DNI peruano sea válido (8 dígitos, no todo ceros).',
      schema: z.object({
        dni: z.string().length(8).describe('DNI de 8 dígitos'),
      }),
      func: async (input) => {
        const result = await this.toolsExecutionService.validarDni(input);
        return JSON.stringify(result);
      },
    });

    // 4️    Generar Proforma
    const generarProformaTool = new DynamicStructuredTool({
      name: 'generar_proforma',
      description: 'Genera un resumen de cotización con TODOS los datos del cliente y departamento que seleccionó. USA ESTO cuando tengas: nombre, DNI validado, ocupación, ingresos, y la unidad que eligió.',
      schema: z.object({
        nombre_cliente: z.string().optional().describe('Nombre completo del cliente'),
        dni: z.string().optional().describe('DNI del cliente (8 dígitos)'),
        ocupacion: z.string().optional().describe('Ocupación del cliente'),
        ingresos: z.string().optional().describe('Ingresos mensuales del cliente'),
        unidad: z.string().optional().describe('Número de unidad elegida (ej: 1003, 1101)'),
        precio: z.string().optional().describe('Precio del departamento'),
        dormitorios: z.number().optional().describe('Cantidad de dormitorios'),
        area: z.string().optional().describe('Área total en m²'),
        piso: z.number().optional().describe('Número de piso'),
      }),
      func: async (input, config) => {
        const metadata = (config as any)?.metadata || {};
        const paramsWithContext = {
          ...input,
          phoneNumber: metadata.phoneNumber,
          codigoEmpresa: metadata.codigoEmpresa,
          leadUuid: metadata.leadUuid
        };
        const result = await this.toolsExecutionService.generarProforma(paramsWithContext);
        return result; // Ya es string, no necesita JSON.stringify
      },
    });

    // 5️   Enviar Brochure
    const enviarBrochureTool = new DynamicStructuredTool({
      name: 'enviar_brochure',
      description: 'Envía el brochure digital del proyecto al WhatsApp del cliente.',
      schema: z.object({
        nombre_proyecto: z.string().describe('Nombre del proyecto'),
      }),
      func: async (input, config) => {
        const { codigoEmpresa, leadUuid, phoneNumber } = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.enviarBrochure({
          nombre_proyecto: input.nombre_proyecto,
          phoneNumber: phoneNumber,
          codigoEmpresa: codigoEmpresa,
          leadUuid: leadUuid,
        });
        return result;
      },
    });

    // 9️Enviar PLANO del departamento (floor plan - imagen)
    const enviarPlanoTool = new DynamicStructuredTool({
      name: 'enviar_plano_departamento',
      description: 'Envía el PLANO (floor plan) de un departamento específico como IMAGEN. Usa SOLO cuando el cliente pida: "plano", "floor plan", "distribución del depa", "envíame el plano". NO uses para ubicación del proyecto.',
      schema: z.object({
        nombre_proyecto: z.string().describe('Nombre del proyecto'),
        unidad_id: z.string().describe('ID de la unidad'),
      }),
      func: async (input, config) => {
        const metadata = (config as any)?.metadata || {};
        const paramsWithContext = {
          ...input,
          phoneNumber: metadata.phoneNumber,
          codigoEmpresa: metadata.codigoEmpresa,
          leadUuid: metadata.leadUuid
        };
        const result = await this.toolsExecutionService.enviarMapa(paramsWithContext);
        return result; // Ya es string, no necesita JSON.stringify
      },
    });

    //  Enviar UBICACIÓN del proyecto (Google Maps link)
    const enviarUbicacionTool = new DynamicStructuredTool({
      name: 'enviar_ubicacion_proyecto',
      description: 'Envía la UBICACIÓN del proyecto en Google Maps. Usa SOLO cuando el cliente pida: "ubicación", "dónde está", "link de google maps", "dirección", "cómo llegar". NO uses para planos de departamentos.',
      schema: z.object({
        nombre_proyecto: z.string().describe('Nombre del proyecto'),
      }),
      func: async (input) => {
        const result = await this.toolsExecutionService.enviarUbicacionGoogleMaps(input);
        return result;
      },
    });

    // Enviar VIDEOS del proyecto (archivos MP4)
    const enviarVideosProyectoTool = new DynamicStructuredTool({
      name: 'enviar_videos_proyecto',
      description: 'Envía los VIDEOS promocionales del proyecto por WhatsApp. Usa SOLO cuando el cliente pida: "videos", "recorrido virtual", "tour", "quiero ver videos", "muéstrame videos", "envíame un video". ENVÍA AMBOS VIDEOS AUTOMÁTICAMENTE. NO confundir con brochure (PDF) ni con planos (imágenes).',
      schema: z.object({
        nombre_proyecto: z.string().describe('Nombre del proyecto'),
      }),
      func: async (input, config) => {
        const { codigoEmpresa, leadUuid, phoneNumber } = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.enviarVideosProyecto({
          nombre_proyecto: input.nombre_proyecto,
          phoneNumber: phoneNumber,
          codigoEmpresa: codigoEmpresa,
          leadUuid: leadUuid,
        });
        return result;
      },
    });

    // HERRAMIENTA UNIVERSAL: Busca departamentos por CUALQUIER criterio
    const buscarDepartamentoUniversalTool = new DynamicStructuredTool({
      name: 'buscar_departamento',
      description: 'HERRAMIENTA ÚNICA Y PRINCIPAL: Busca departamentos en inventario real (Qdrant) por CUALQUIER criterio. USA ESTA HERRAMIENTA PARA TODO lo relacionado con búsqueda de departamentos: unidad específica, dormitorios, piso, precio, cuota mensual, vista, tipología, área. Ejemplos: "unidad 1003", "2 dormitorios", "piso 5", "cuota de S/5000", "vista exterior", "departamentos disponibles". Retorna información COMPLETA y REAL del inventario.',
      schema: z.object({
        unidad: z.string().optional().describe('Número de unidad específica (ej: "1003", "1701")'),
        dormitorios: z.number().optional().describe('Cantidad de dormitorios (1, 2, 3)'),
        piso: z.number().optional().describe('Piso específico (1-17)'),
        precio_max: z.number().optional().describe('Precio máximo en soles'),
        precio_min: z.number().optional().describe('Precio mínimo en soles'),
        vista: z.string().optional().describe('Vista: "exterior" o "interior"'),
        tipologia: z.string().optional().describe('Tipología: "Tipo 1", "Tipo 2", etc.'),
        area_min: z.number().optional().describe('Área mínima en m²'),
      }),
      func: async (input, config) => {
        const metadata = (config as any)?.metadata || {};

        const paramsWithContext = {
          ...input,
          phoneNumber: metadata.phoneNumber,
          codigoEmpresa: metadata.codigoEmpresa,
          leadUuid: metadata.leadUuid
        };
        return await this.toolsExecutionService.buscarDepartamentoUniversal(paramsWithContext);
      },
    });

    // Agregar todas las tools al array
    this.tools = [
      buscarDepartamentoUniversalTool,  //ÚNICA herramienta para TODAS las búsquedas de departamentos
      agendarCitaTool,
      buscarPreguntasFrecuentesTool,            // Para FAQs, características, amenidades
      validarDniTool,
      generarProformaTool,
      enviarBrochureTool,
      enviarPlanoTool,                  // PLANO del departamento (imagen)
      enviarUbicacionTool,              // UBICACIÓN del proyecto (Google Maps)
      enviarVideosProyectoTool,         // VIDEOS promocionales del proyecto (MP4)
    ];

    this.logger.log(`Agente inicializado con ${this.tools.length} herramientas`);
  }

  /**
   * Ejecuta el agente con loop automático de tools
   * Versión robusta que maneja múltiples llamadas a tools
   * 
   * @param systemPrompt - Instrucciones del sistema
   * @param mensajeUsuario - Mensaje actual del usuario
   * @param historial - Historial de conversación
   * @param metadata - Datos adicionales (codigoEmpresa, leadUuid, etc.)
   * @returns Respuesta del agente
   */
  async ejecutarAgente(
    systemPrompt: string,
    mensajeUsuario: string,
    historial: BaseMessage[] = [],
    metadata: {
      codigoEmpresa: number;
      leadUuid: string;
      nombreLead?: string;
      proyectoInteres?: string;
      phoneNumber?: string;
    }
  ): Promise<{
    output: string;
    tokensUsados?: { input: number; output: number };
    toolsEjecutados: string[];
  }> {
    try {
      this.logger.log(`Ejecutando agente para lead: ${metadata.leadUuid}`);

      const toolsEjecutados: string[] = [];
      let tokensAcumulados = { input: 0, output: 0 };

      const modelWithTools = this.llm.bindTools(this.tools);

      // Construir mensajes iniciales
      const messages: BaseMessage[] = [...historial];

      // Generar Contexto Temporal (Fecha Actual)
      const now = new Date();
      const fechaISO = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const fechaLegible = now.toLocaleString('es-PE', {
        timeZone: 'America/Lima',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      const timeContext = `
=== CONTEXTO TEMPORAL DEL SERVIDOR ===
DATOS ACTUALES:
- FECHA ISO: ${fechaISO} (Úsala para comparar)
- FECHA LEGIBLE: ${fechaLegible}

REGLAS DE TIEMPO (CRÍTICAS):
1. **SI LA FECHA DE LA CITA ES ${fechaISO} → DEBES DECIR "HOY"**.
2. Si la fecha de la cita es diferente, calcula si es "mañana" o el día de la semana.
3. JAMÁS digas "mañana" si la fecha es igual a la FECHA ISO actual.
4. Tómate un segundo para verificar: ¿Fecha Cita === Fecha Actual? -> Entonces es HOY.
======================================
`;

      const finalSystemPrompt = `${timeContext}\n\n${systemPrompt}`;

      // Control de herramientas ejecutadas para evitar duplicados
      const accionesEjecutadas = new Set<string>();

      // Máximo de iteraciones para evitar loops infinitos
      const maxIteraciones = 5;
      let iteracion = 0;

      while (iteracion < maxIteraciones) {
        iteracion++;
        this.logger.log(`Iteración ${iteracion}/${maxIteraciones}`);

        // Invocar modelo con tools
        const response = await modelWithTools.invoke([
          { role: 'system', content: finalSystemPrompt },
          ...messages,
          { role: 'user', content: mensajeUsuario }
        ]);

        // Acumular tokens
        const tokens = this.extraerTokens(response);
        if (tokens) {
          tokensAcumulados.input += tokens.input;
          tokensAcumulados.output += tokens.output;
        }

        // Si NO hay tool_calls, esta es la respuesta final
        if (!response.tool_calls || response.tool_calls.length === 0) {
          this.logger.log('Respuesta sin tool_calls - Finalizando');

          const output = response.content?.toString() || "No pude generar una respuesta.";

          this.logger.log(`Agente completado - Tools usados: ${toolsEjecutados.join(', ') || 'ninguno'}`);

          return {
            output,
            tokensUsados: tokensAcumulados,
            toolsEjecutados,
          };
        }

        // HAY tool_calls - Procesarlos
        this.logger.log(`Procesando ${response.tool_calls.length} tool_calls`);

        // Agregar respuesta del modelo a mensajes
        messages.push(response);

        // Ejecutar TODOS los tool_calls y agregar sus respuestas
        for (const toolCall of response.tool_calls) {
          this.logger.log(`Ejecutando tool: ${toolCall.name}`);

          let toolResult: string;

          // Verificar si la tool ya fue ejecutada en esta sesión
          if (accionesEjecutadas.has(toolCall.name)) {
            this.logger.warn(`Tool ${toolCall.name} ya fue ejecutada, enviando mensaje de bloqueo`);
            toolResult = `[BLOQUEADO] La herramienta ${toolCall.name} ya fue ejecutada. Genera tu respuesta final con la información que ya tienes.`;
          } else {
            try {
              // Encontrar tool
              const tool = this.tools.find(t => t.name === toolCall.name);

              if (!tool) {
                throw new Error(`Tool '${toolCall.name}' no encontrada`);
              }

              // Ejecutar tool
              toolResult = await tool.func(toolCall.args, { metadata } as any);

              // Marcar como ejecutada
              accionesEjecutadas.add(toolCall.name);
              toolsEjecutados.push(toolCall.name);

              // Guardar en historial
              try {
                await this.historialChatService.guardarMensaje({
                  leadUuid: metadata.leadUuid,
                  codigoEmpresa: metadata.codigoEmpresa,
                  mensaje: { role: 'function', content: `[${toolCall.name}] ${toolResult}` },
                  role: 'function',
                  metadatos: { toolName: toolCall.name, args: toolCall.args }
                });
              } catch (histError) {
                this.logger.warn(`No se pudo guardar tool en historial: ${histError.message}`);
              }

            } catch (error) {
              this.logger.error(`Error ejecutando tool ${toolCall.name}: ${error.message}`);
              toolResult = `Error ejecutando ${toolCall.name}: ${error.message}`;
            }
          }

          // SIEMPRE agregar ToolMessage para cada tool_call
          messages.push(
            new ToolMessage({
              tool_call_id: toolCall.id,
              content: toolResult,
            })
          );
        }

        // Continuar al siguiente loop - el modelo generará respuesta o pedirá más tools
      }

      // Si llegamos aquí, alcanzamos max iteraciones
      this.logger.warn(`Agente alcanzó máximo de iteraciones (${maxIteraciones})`);

      // Hacer una llamada final SIN tools para forzar respuesta de texto
      try {
        const finalResponse = await this.llm.invoke([
          { role: 'system', content: finalSystemPrompt + '\n\nGENERA TU RESPUESTA FINAL AHORA. No llames más herramientas.' },
          ...messages,
        ]);

        const output = finalResponse.content?.toString() || "No pude generar una respuesta.";

        return {
          output,
          tokensUsados: tokensAcumulados,
          toolsEjecutados,
        };
      } catch (finalError) {
        this.logger.error(`Error generando respuesta final: ${finalError.message}`);
        return {
          output: "Hubo un problema procesando tu solicitud. Por favor intenta de nuevo.",
          tokensUsados: tokensAcumulados,
          toolsEjecutados,
        };
      }

    } catch (error) {
      this.logger.error(`Error en agente: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extrae tokens del response del agente
   */
  private extraerTokens(result: any): { input: number; output: number } | undefined {
    const usage = result.usage_metadata || result.response_metadata?.usage;

    if (usage) {
      return {
        input: usage.prompt_tokens || usage.input_tokens || 0,
        output: usage.completion_tokens || usage.output_tokens || 0,
      };
    }

    return undefined;
  }
}
