import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolsExecutionService } from './tools/tools-execution.service';
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
  ) {
    // LLM con function calling (GPT-4)
    const modelName = this.configService.get<string>('IA_MODEL_NAME') || 'o4-mini';
    const isReasoningModel = modelName.includes('o1-') || modelName.includes('o3-') || modelName.startsWith('o');

    // Modelos de razonamiento (o1, o3, etc) no soportan temperature 0 (o tienen fixed temp)
    const temperature = isReasoningModel ? 1 : 0;

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
      }),
      func: async (input, config) => {
        // Metadata se pasa via config.metadata desde AgentExecutor
        const { codigoEmpresa, leadUuid } = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.agendarCita(input, codigoEmpresa, leadUuid);
        return JSON.stringify(result);
      },
    });

    // 2️    Buscar Información (RAG con Qdrant)
    const buscarInformacionTool = new DynamicStructuredTool({
      name: 'buscar_informacion',
      description: 'Busca información detallada sobre proyectos, precios, características, ubicaciones en la base de conocimientos.',
      schema: z.object({
        queries_de_busqueda: z.array(z.string()).describe('Lista de consultas específicas para buscar'),
        nombre_proyecto: z.string().describe('Nombre del proyecto para filtrar resultados'),
      }),
      func: async (input) => {
        const result = await this.toolsExecutionService.buscarInformacion(input);
        return result; // Ya es un string, no necesita JSON.stringify
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
      func: async (input) => {
        const result = await this.toolsExecutionService.generarProforma(input);
        return result; // Ya es string, no necesita JSON.stringify
      },
    });

    // 5️    Enviar Brochure
    const enviarBrochureTool = new DynamicStructuredTool({
      name: 'enviar_brochure',
      description: 'Envía el brochure digital del proyecto al WhatsApp del cliente.',
      schema: z.object({
        nombre_proyecto: z.string().describe('Nombre del proyecto'),
        formato: z.enum(['pdf', 'imagen']).describe('Formato del brochure'),
      }),
      func: async (input) => {
        const result = await this.toolsExecutionService.enviarBrochure(input);
        return result; // Ya es string, no necesita JSON.stringify
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

    // 🔥 HERRAMIENTA UNIVERSAL: Busca departamentos por CUALQUIER criterio
    const buscarDepartamentoUniversalTool = new DynamicStructuredTool({
      name: 'buscar_departamento',
      description: 'HERRAMIENTA ÚNICA Y PRINCIPAL: Busca departamentos en inventario real (Qdrant) por CUALQUIER criterio. USA ESTA HERRAMIENTA PARA TODO lo relacionado con búsqueda de departamentos: unidad específica, dormitorios, piso, precio, cuota mensual, vista, tipología, área. Ejemplos: "unidad 1003", "2 dormitorios", "piso 5", "cuota de S/5000", "vista exterior", "departamentos disponibles". Retorna información COMPLETA y REAL del inventario.',
      schema: z.object({
        unidad: z.string().optional().describe('Número de unidad específica (ej: "1003", "1701")'),
        dormitorios: z.number().optional().describe('Cantidad de dormitorios (1, 2, 3)'),
        piso: z.number().optional().describe('Piso específico (1-17)'),
        precio_max: z.number().optional().describe('Precio máximo en soles'),
        precio_min: z.number().optional().describe('Precio mínimo en soles'),
        cuota_mensual: z.number().optional().describe('Cuota mensual que puede pagar (se calcula precio_max = cuota * 200)'),
        vista: z.string().optional().describe('Vista: "exterior" o "interior"'),
        tipologia: z.string().optional().describe('Tipología: "Tipo 1", "Tipo 2", etc.'),
        area_min: z.number().optional().describe('Área mínima en m²'),
      }),
      func: async (input, config) => {
        const metadata = (config as any)?.metadata || {};

        // Si viene cuota_mensual, calcular precio_max
        if (input.cuota_mensual && !input.precio_max) {
          input.precio_max = input.cuota_mensual * 200; // Fórmula aproximada
        }

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
      buscarInformacionTool,            // Para FAQs, características, amenidades
      validarDniTool,
      generarProformaTool,
      enviarBrochureTool,
      enviarPlanoTool,                  // PLANO del departamento (imagen)
      enviarUbicacionTool,              // UBICACIÓN del proyecto (Google Maps)
    ];

    this.logger.log(`Agente inicializado con ${this.tools.length} herramientas`);
  }

  /**
   * Ejecuta el agente con loop automático de tools
   * Versión simplificada sin AgentExecutor (compatible con todas las versiones de LangChain)
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

      // 2️    Construir mensajes iniciales
      const messages: BaseMessage[] = [
        ...historial,
      ];

      // 3️    Loop de ejecución de tools (máximo 5 iteraciones)
      let iteracion = 0;
      const maxIteraciones = 5;
      let respuestaFinal: AIMessage | null = null;

      while (iteracion < maxIteraciones) {
        iteracion++;
        this.logger.log(`Iteración ${iteracion}/${maxIteraciones}`);

        // Invocar modelo
        const response = await modelWithTools.invoke(
          [
            { role: 'system', content: systemPrompt },
            ...messages,
            { role: 'user', content: mensajeUsuario }
          ]
        );

        // Acumular tokens
        const tokens = this.extraerTokens(response);
        if (tokens) {
          tokensAcumulados.input += tokens.input;
          tokensAcumulados.output += tokens.output;
        }

        // Agregar respuesta a mensajes
        messages.push(response);

        if (!response.tool_calls || response.tool_calls.length === 0) {

          respuestaFinal = response;
          break;
        }

        // Ejecutar tools
        for (const toolCall of response.tool_calls) {
          this.logger.log(`Ejecutando tool: ${toolCall.name}`);
          toolsEjecutados.push(toolCall.name);

          try {
            // Encontrar tool
            const tool = this.tools.find(t => t.name === toolCall.name);

            if (!tool) {
              throw new Error(`Tool '${toolCall.name}' no encontrada`);
            }

            // Ejecutar tool (pasando metadata via config)
            const toolResult = await tool.func(toolCall.args, {
              metadata,
            } as any);

            // Agregar resultado como ToolMessage
            messages.push(
              new ToolMessage({
                tool_call_id: toolCall.id,
                content: toolResult,
              })
            );

          } catch (error) {
            this.logger.error(` Error ejecutando tool ${toolCall.name}: ${error.message}`);
            // Agregar error como resultado
            messages.push(
              new ToolMessage({
                tool_call_id: toolCall.id,
                content: `Error: ${error.message}`,
              })
            );
          }
        }

        // Continuar al siguiente loop para generar respuesta final
      }

      if (iteracion >= maxIteraciones) {
        this.logger.warn(`Agente alcanzó máximo de iteraciones (${maxIteraciones})`);
      }

      // Extraer respuesta final
      const output = respuestaFinal?.content?.toString() ||
        messages[messages.length - 1]?.content?.toString() ||
        "No pude generar una respuesta.";

      this.logger.log(`Agente completado - Tools usados: ${toolsEjecutados.join(', ') || 'ninguno'}`);

      return {
        output,
        tokensUsados: tokensAcumulados,
        toolsEjecutados,
      };

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
