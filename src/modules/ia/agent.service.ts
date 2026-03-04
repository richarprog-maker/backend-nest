import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolsExecutionService } from './tools/tools-execution.service';
import { HistorialChatService } from './historial-chat.service';
import { ResumenConversacionService } from './resumen-conversacion.service';
import { BaseMessage, AIMessage, ToolMessage } from '@langchain/core/messages';


@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private llm: ChatOpenAI;
  private tools: DynamicStructuredTool[] = [];

  constructor(
    private configService: ConfigService,
    private toolsExecutionService: ToolsExecutionService,
    private historialChatService: HistorialChatService,
    private resumenService: ResumenConversacionService,
  ) {
    const modelName = this.configService.get<string>('OPENAI_MODEL') || 'o4-mini';
    const isReasoningModel = modelName.includes('o1-') || modelName.includes('o3-') || modelName.includes('o4-') || modelName === 'o4-mini';

    const temperature = isReasoningModel ? 1 : 0.7;

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
    // 1️ Agendar Cita (Primera vez)
    const agendarCitaTool = new DynamicStructuredTool({
      name: 'agendar_cita',
      description: 'Agenda una cita por PRIMERA VEZ (NO tiene cita previa). Usa la fecha y hora EXACTA que el cliente solicita. Retorna confirmación o error si horario ocupado. NUNCA uses si ya tiene cita, usa reagendar_cita.',
      schema: z.object({
        fecha_cita: z.string().describe('Fecha EXACTA que pidió el cliente en formato YYYY-MM-DD'),
        hora_cita: z.string().describe('Hora EXACTA que pidió el cliente en formato HH:MM (24h)'),
        nombre_proyecto: z.string().describe('Nombre del proyecto a visitar'),
        tipo_cita: z.enum(['presencial', 'virtual']).describe('Tipo de visita (presencial por defecto)'),
        email: z.string().optional().describe('Email del cliente para confirmación'),
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

    // 1.1️ Reagendar Cita (Ya tiene cita)
    const reagendarCitaTool = new DynamicStructuredTool({
      name: 'reagendar_cita',
      description: 'SOLO para MODIFICAR una cita EXISTENTE. CRÍTICO: Validará que exista cita previa y fallará si no existe. USA cuando cliente YA TIENE cita agendada y quiere cambiar tipo/fecha/hora. NUNCA uses junto con agendar_cita en la misma respuesta.',
      schema: z.object({
        tipo_cita_nuevo: z.enum(['PRESENCIAL', 'VIRTUAL']).optional().describe('Nuevo tipo solo si quiere cambiar'),
        fecha_nueva: z.string().optional().describe('Nueva fecha EXACTA YYYY-MM-DD solo si quiere cambiar'),
        hora_nueva: z.string().optional().describe('Nueva hora EXACTA HH:MM solo si quiere cambiar'),
        motivo_cambio: z.string().describe('Razón del cambio (ej: "Cliente prefiere horario de tarde")'),
      }),
      func: async (input, config) => {
        const { codigoEmpresa, leadUuid } = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.reagendarCita(input, codigoEmpresa, leadUuid);
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
      func: async (input, config) => {
        const metadata = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.buscarPreguntasFrecuentes(input, metadata.proyectoId);
        return result;
      },
    });

    // 3️    Validar DNI
    const validarDniTool = new DynamicStructuredTool({
      name: 'validar_dni',
      description: 'Valida que un DNI peruano sea válido (8 dígitos, no todo ceros) y lo guarda en el sistema.',
      schema: z.object({
        dni: z.string().length(8).describe('DNI de 8 dígitos'),
      }),
      func: async (input, config) => {
        const { codigoEmpresa, leadUuid } = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.validarDni({
          ...input,
          leadUuid,
          codigoEmpresa,
        });
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
      description: 'DEPRECADA - NO USAR. Para ubicación, dirección o Google Maps del proyecto, usa buscar_preguntas_frecuentes con query ["direccion del proyecto", "ubicacion Google Maps"]. Esta herramienta solo existe como respaldo.',
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
      description: 'Envía los VIDEOS promocionales del proyecto por WhatsApp (archivos MP4). Usa SOLO cuando el cliente pida: "videos", "quiero ver videos", "muéstrame videos", "envíame un video". ENVÍA AMBOS VIDEOS AUTOMÁTICAMENTE. NO confundir con brochure (PDF), planos (imágenes), ni con RECORRIDO VIRTUAL (para recorrido virtual usa buscar_preguntas_frecuentes).',
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
      description: 'HERRAMIENTA ÚNICA Y PRINCIPAL: Busca departamentos en inventario real (Qdrant). SI EL USUARIO PIDE VARIOS TIPOS (ej: "2 y 3 dormitorios"), ENVÍA UN ARRAY: [2, 3]. Busca por: unidad, dormitorios, piso, precio, cuota, vista, tipología, tipo de unidad (Duplex/Flat), área. Retorna información COMPLETA y REAL.',
      schema: z.object({
        unidad: z.string().optional().describe('Número de unidad específica (ej: "1003", "1701")'),
        dormitorios: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]).optional().describe('Cantidad de dormitorios (ej: 2, "monoambiente" o [2, "monoambiente"])'),
        piso: z.number().optional().describe('Piso específico (1-17)'),
        precio_max: z.number().optional().describe('Precio máximo en soles'),
        precio_min: z.number().optional().describe('Precio mínimo en soles'),
        vista: z.string().optional().describe('Vista: "exterior" o "interior"'),
        tipologia: z.string().optional().describe('Tipología: "Tipo 1", "Tipo 2", etc.'),
        tipo_unidad: z.string().optional().describe('Tipo de unidad: "Duplex" o "Flat". Usa cuando el cliente pide específicamente duplex o flat. SIEMPRE capitalizado.'),
        area_min: z.number().optional().describe('Área mínima en m²'),
        preferencia_piso: z.enum(['bajos', 'altos']).optional().describe('"bajos" si pide pisos bajos (ordena 1,2,3...), "altos" si pide pisos altos (ordena 17,16,15...)'),
      }),
      func: async (input, config) => {
        const metadata = (config as any)?.metadata || {};

        const paramsWithContext = {
          ...input,
          phoneNumber: metadata.phoneNumber,
          codigoEmpresa: metadata.codigoEmpresa,
          leadUuid: metadata.leadUuid
        };
        return await this.toolsExecutionService.buscarDepartamentoUniversal({
          ...paramsWithContext,
          dormitorios: input.dormitorios,
          proyectoId: metadata.proyectoId
        });
      },
    });

    // Descartar Cliente
    const descartarClienteTool = new DynamicStructuredTool({
      name: 'descartar_cliente',
      description: 'USA INMEDIATAMENTE cuando el cliente pida que NO lo contacten más o se moleste. Señales: "No me escriban", "Ya no me contacten", "Me están molestando", "Déjenme en paz", cualquier RECHAZO EXPLÍCITO.',
      schema: z.object({
        motivo: z.string().describe('Razón del descarte según lo que dijo el cliente'),
      }),
      func: async (input, config) => {
        const { codigoEmpresa, leadUuid } = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.descartarCliente({
          motivo: input.motivo,
          leadUuid: leadUuid,
          codigoEmpresa: codigoEmpresa
        });
        return JSON.stringify(result);
      },
    });

    const guardarProyectoTool = new DynamicStructuredTool({
      name: 'guardar_proyecto',
      description: 'ACTUALIZA el proyecto del cliente en la base de datos. OBLIGATORIO ejecutar cuando: (1) El cliente elige un proyecto por primera vez, (2) El cliente CONFIRMA que quiere cambiarse a otro proyecto. NO ejecutes solo porque pidio un brochure o info de otro proyecto. Pero si despues de dar info el cliente dice "si me interesa ese", "cambienme", "prefiero ese" -> EJECUTA INMEDIATAMENTE para actualizar la BD.',
      schema: z.object({
        nombre_proyecto: z.string().describe('Nombre del proyecto que eligio o al que quiere cambiarse'),
      }),
      func: async (input, config) => {
        const { codigoEmpresa, leadUuid } = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.guardarProyecto(input, codigoEmpresa, leadUuid);
        return JSON.stringify(result);
      },
    });

    this.tools = [
      buscarDepartamentoUniversalTool,
      agendarCitaTool,
      reagendarCitaTool,
      buscarPreguntasFrecuentesTool,
      validarDniTool,
      generarProformaTool,
      enviarBrochureTool,
      enviarPlanoTool,
      enviarUbicacionTool,
      enviarVideosProyectoTool,
      descartarClienteTool,
      guardarProyectoTool,
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
      proyectoId?: number;
    }
  ): Promise<{
    output: string;
    tokensUsados?: { input: number; output: number };
    toolsEjecutados: string[];
  }> {
    try {
      this.logger.log(`Ejecutando agente para lead: ${metadata.leadUuid}`);

      // Extraer información del mensaje del usuario y actualizar resumen
      await this.extraerYGuardarResumen(mensajeUsuario, metadata.leadUuid, metadata.codigoEmpresa);

      const toolsEjecutados: string[] = [];
      let tokensAcumulados = { input: 0, output: 0 };

      const modelWithTools = this.llm.bindTools(this.tools);

      // Construir mensajes iniciales
      const messages: BaseMessage[] = [...historial];

      // Generar Contexto Temporal (Fecha Actual en zona horaria de Perú)
      const nowPeru = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
      const fechaISO = `${nowPeru.getFullYear()}-${String(nowPeru.getMonth() + 1).padStart(2, '0')}-${String(nowPeru.getDate()).padStart(2, '0')}`;
      const horaActual = `${String(nowPeru.getHours()).padStart(2, '0')}:${String(nowPeru.getMinutes()).padStart(2, '0')}`;
      const fechaLegible = new Date().toLocaleString('es-PE', {
        timeZone: 'America/Lima',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      // Calcular fecha de mañana en Perú
      const tomorrowPeru = new Date(nowPeru);
      tomorrowPeru.setDate(tomorrowPeru.getDate() + 1);
      const fechaMananaISO = `${tomorrowPeru.getFullYear()}-${String(tomorrowPeru.getMonth() + 1).padStart(2, '0')}-${String(tomorrowPeru.getDate()).padStart(2, '0')}`;

      const timeContext = `
=== CONTEXTO TEMPORAL (ZONA: PERÚ) ===
- FECHA HOY: ${fechaISO}
- FECHA MAÑANA: ${fechaMananaISO}
- HORA ACTUAL: ${horaActual}
- ${fechaLegible}

REGLAS GENERALES:
- HORARIO DE ATENCIÓN: 10:00 a 19:00 (7pm). NO agendes fuera de ese horario.
- NO agendes citas para fechas pasadas ni horas que ya pasaron hoy.
- Para referirte a fechas: si es ${fechaISO} di "hoy", si es ${fechaMananaISO} di "mañana", si ya pasó di que "ya pasó".
======================================
`;

      const finalSystemPrompt = `${timeContext}\n\n${systemPrompt}`;

      // Control de herramientas ejecutadas para evitar duplicados
      const accionesEjecutadas = new Set<string>();

      const HERRAMIENTAS_EXCLUYENTES: Record<string, string[]> = {
        'agendar_cita': ['reagendar_cita'],
        'reagendar_cita': ['agendar_cita'],
      };

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
          } else if (HERRAMIENTAS_EXCLUYENTES[toolCall.name]?.some(excl => accionesEjecutadas.has(excl))) {
            const ejecutada = HERRAMIENTAS_EXCLUYENTES[toolCall.name].find(excl => accionesEjecutadas.has(excl));
            this.logger.warn(`[BLOQUEO MUTUO] ${toolCall.name} bloqueada porque ${ejecutada} ya se ejecutó`);
            toolResult = `[BLOQUEADO] No puedes usar ${toolCall.name} porque ya se ejecutó ${ejecutada}. Son herramientas mutuamente excluyentes. Usa la respuesta de ${ejecutada} para tu mensaje final.`;
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

              // Auto-sincronizar proyecto en sesión si la tool usó un nombre_proyecto
              if (toolCall.args?.nombre_proyecto && metadata.leadUuid && metadata.codigoEmpresa) {
                await this.toolsExecutionService.sincronizarProyectoSesion(
                  toolCall.args.nombre_proyecto,
                  metadata.codigoEmpresa,
                  metadata.leadUuid
                );
              }

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


  /**
   * Extrae información relevante del mensaje del usuario usando LLM
   * y la guarda en el resumen de conversación
   */
  private async extraerYGuardarResumen(
    mensaje: string,
    leadUuid: string,
    codigoEmpresa: number
  ): Promise<void> {
    try {
      // Schema para extracción estructurada
      const InfoResumenSchema = z.object({
        dormitorios: z.array(z.number()).describe('Lista de cantidad de dormitorios mencionados (ej: [2, 3]). Si no hay, array vacio.'),
        proposito: z.enum(['vivir', 'inversion', 'mix_uso']).nullable().describe('Propósito de compra si se menciona. Null si no hay.'),
        zonas: z.array(z.string()).describe('Distritos o zonas de interés mencionados. Si no hay, array vacios.'),
        tiempo_compra: z.string().nullable().describe('Tiempo estimado de compra (ej: "este mes", "2026", "pronto"). Null si no hay.'),
        financiamiento: z.enum(['hipotecario', 'banco', 'directo', 'contado']).nullable().describe('Tipo de financiamiento mencionado. Null si no hay.'),
        presupuesto: z.string().nullable().describe('Presupuesto o cuota mencionada (ej: "500k", "cuota 3000"). Null si no hay.'),
        ingresos: z.string().nullable().describe('Ingresos mensuales del cliente. MANTÉN RANGOS si existen (ej: "5000-6000", "5k a 6k"). Null si no hay.'),
        intereses_adicionales: z.array(z.string()).describe('Temas adicionales: estacionamiento, mascota, entrega, areas_comunes, inicial. Si no hay, array vacio.'),
      });

      const extractor = this.llm.withStructuredOutput(InfoResumenSchema);

      const prompt = `
      Analiza el siguiente mensaje del cliente inmobiliario. Un solo mensaje puede contener MULTIPLES datos de distintas categorias. Extrae TODOS los datos que encuentres, no solo uno.

      IMPORTANTE: Si el mensaje tiene varios datos juntos, captúralos TODOS. Ejemplos:
      - "para inversión en Lince" → proposito: "inversion" Y zonas: ["Lince"]
      - "busco 2 dormitorios para vivir en Surco o Miraflores" → dormitorios: [2] Y proposito: "vivir" Y zonas: ["Surco", "Miraflores"]
      - "quiero un depa de 3 cuartos, mi presupuesto es 3000 soles de cuota, crédito hipotecario" → dormitorios: [3] Y presupuesto: "3000 soles cuota" Y financiamiento: "hipotecario"
      - "mis ingresos son 5000-6000" → ingresos: "5000-6000"
      - "gano 8k" → ingresos: "8k"

      Si no hay información de un tipo, déjalo vacío. Ignora saludos o ruido.
      
      Mensaje: "${mensaje}"
      `;

      const result = await extractor.invoke(prompt);
      const puntos: string[] = [];

      // Mapear resultados a formato de resumen
      if (result.dormitorios && result.dormitorios.length > 0) {
        const dormsStr = result.dormitorios.sort().join(' y ');
        puntos.push(`Busca depa de ${dormsStr} dormitorio(s)`);
      }

      if (result.proposito) {
        const mapa: Record<string, string> = { 'vivir': 'para vivir', 'inversion': 'inversión', 'mix_uso': 'uso mixto' };
        puntos.push(`Propósito: ${mapa[result.proposito] || result.proposito}`);
      }

      if (result.zonas && result.zonas.length > 0) {
        // Capitalizar
        const zonasCap = result.zonas.map(z => z.charAt(0).toUpperCase() + z.slice(1).toLowerCase()).join(', ');
        puntos.push(`Zona preferida: ${zonasCap}`);
      }

      if (result.tiempo_compra) {
        puntos.push(`Tiempo de compra: ${result.tiempo_compra}`);
      }

      if (result.financiamiento) {
        const mapa: Record<string, string> = {
          'hipotecario': 'crédito hipotecario',
          'banco': 'crédito hipotecario',
          'directo': 'directo con Checor',
          'contado': 'al contado'
        };
        puntos.push(`Financiamiento: ${mapa[result.financiamiento] || result.financiamiento}`);
      }

      if (result.presupuesto) {
        puntos.push(`Presupuesto/Cuota: ${result.presupuesto}`);
      }

      if (result.ingresos) {
        puntos.push(`Ingresos mensuales: ${result.ingresos}`);
      }

      // Intereses adicionales mapeados
      if (result.intereses_adicionales && result.intereses_adicionales.length > 0) {
        const mapaInteres: Record<string, string> = {
          'estacionamiento': 'Preguntó por estacionamiento',
          'mascota': 'Preguntó por política de mascotas',
          'entrega': 'Preguntó por fecha de entrega',
          'areas_comunes': 'Preguntó por áreas comunes',
          'inicial': 'Preguntó por cuota inicial'
        };

        result.intereses_adicionales.forEach(interes => {
          // Buscar match parcial o directo en el mapa
          const key = Object.keys(mapaInteres).find(k => interes.toLowerCase().includes(k));
          if (key) puntos.push(mapaInteres[key]);
        });
      }

      // Solo guardar si hay puntos nuevos
      if (puntos.length > 0) {
        await this.resumenService.agregarPuntos(leadUuid, codigoEmpresa, puntos);
        this.logger.debug(`Resumen actualizado (LLM) con ${puntos.length} puntos: ${puntos.join(', ')}`);
      }

    } catch (error) {
      this.logger.warn(`Error extrayendo resumen con LLM: ${error.message}`);
      // Fallback a regex básico o simplemente ignorar error para no detener flujo
    }
  }
}
