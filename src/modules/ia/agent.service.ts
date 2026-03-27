import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolsExecutionService } from './tools/tools-execution.service';
import { HistorialChatService } from './historial-chat.service';
import { ResumenConversacionService } from './resumen-conversacion.service';
import { BaseMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { Proyecto } from '../proyectos/entities/proyecto.entity';
import { Lead } from '../inbox/entities/lead.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenTrackingService } from './token-tracking.service';
import { parseSessionSummary } from './utils/session-summary.utils';

interface AgentPromptConfig {
  stablePrompt: string;
  variablePrompt: string;
  pasoPendiente: number;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private llm: ChatOpenAI;
  private summaryExtractorLlm: ChatOpenAI;
  private toolsCache = new Map<number, { tools: DynamicStructuredTool[], expiresAt: number }>();

  constructor(
    private configService: ConfigService,
    private toolsExecutionService: ToolsExecutionService,
    private historialChatService: HistorialChatService,
    private resumenService: ResumenConversacionService,
    private tokenTrackingService: TokenTrackingService,
    @InjectRepository(Proyecto)
    private proyectosRepo: Repository<Proyecto>,
    @InjectRepository(Lead)
    private leadRepo: Repository<Lead>,
  ) {
    const modelName = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
    const isReasoningModel = modelName.includes('o1-') || modelName.includes('o3-') || modelName.includes('o4-') || modelName === 'o4-mini' || modelName.includes('gpt-5');

    const temperature = isReasoningModel ? 1 : 0.3;

    this.logger.log(`Inicializando IA con modelo: ${modelName} (Reasoning: ${isReasoningModel}, Temp: ${temperature})`);

    this.llm = new ChatOpenAI({
      modelName: modelName,
      temperature: temperature,
      // maxTokens: 800, // Comentado porque modelos de razonamiento (gpt-5-mini/o1) consumen tokens ocultos pensando y se cortan con límites bajos.
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });

    this.summaryExtractorLlm = new ChatOpenAI({
      modelName: this.configService.get<string>('OPENAI_SUMMARY_MODEL') || 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 400,
      openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
  }

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private addSummaryPoint(puntos: string[], punto?: string): void {
    if (!punto) return;
    if (!puntos.includes(punto)) {
      puntos.push(punto);
    }
  }

  private isValidDniFormat(dni?: string | null): boolean {
    if (!dni) return false;
    const normalized = dni.trim();
    return /^\d{8}$/.test(normalized) && normalized !== '00000000' && !normalized.startsWith('00');
  }

  private isValidEmail(email?: string | null): boolean {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  private parseNombreCompleto(nombreCompleto: string): { nombre?: string; apellido?: string } {
    const normalized = (nombreCompleto || '').trim().replace(/\s+/g, ' ');
    if (!normalized) return {};

    const partes = normalized.split(' ');
    if (partes.length === 1) {
      return { nombre: partes[0] };
    }

    return {
      nombre: partes[0],
      apellido: partes.slice(1).join(' '),
    };
  }

  private async sincronizarDatosLeadExtraidos(
    leadUuid: string,
    codigoEmpresa: number,
    result: {
      nombre_completo?: string | null;
      dni?: string | null;
      email?: string | null;
    },
  ): Promise<void> {
    const lead = await this.leadRepo.findOne({
      where: { uuid: leadUuid, codigoEmpresa },
    });

    if (!lead) {
      return;
    }

    const updateData: Partial<Lead> = {};
    const nombreParsed = this.parseNombreCompleto(result.nombre_completo || '');

    if (nombreParsed.nombre && !lead.nombre) {
      updateData.nombre = nombreParsed.nombre;
    }

    if (nombreParsed.apellido && !lead.apellido) {
      updateData.apellido = nombreParsed.apellido;
    }

    if (this.isValidEmail(result.email) && !lead.email) {
      updateData.email = result.email!.trim().toLowerCase();
    }


    if (Object.keys(updateData).length > 0) {
      await this.leadRepo.update({ uuid: leadUuid, codigoEmpresa }, updateData);
    }
  }



  private async hasExplicitUnitSelection(userMessage: string, unidad?: string): Promise<boolean> {
    if (!userMessage?.trim()) return false;

    try {
      const SeleccionSchema = z.object({
        seleccion_explicita: z.boolean().describe(
          'true si el cliente está eligiendo/confirmando una unidad específica o posición de lista (primera, segunda, tercera, la 801, el 1201, opción 2, etc.). false si solo está preguntando, mencionando o comentando.'
        ),
      });

      const unidadCtx = unidad ? `La unidad en cuestión es: "${unidad}".` : '';
      const prompt = `Eres un detector de intención inmobiliaria en ventas inmobiliarias peruanas. ${unidadCtx}
Tu tarea: determinar si el cliente está ELIGIENDO o CONFIRMANDO activamente una opción/unidad de la lista que el asesor le mostró.

Selección EXPLÍCITA (seleccion_explicita: true) — CUALQUIERA de estos casos:
- Ordinal en español: "la primera", "la segunda", "la tercera", "el primero"
- Número de posición en lista: "la 1", "la 2", "la 3", "el 1", "el 2", "el 3"
- Frases con posición: "a ver la 3", "a ver la 3 porfa", "quiero ver la 2", "dame la 3", "esa la tercera", "muestrame la 2"
- Número de opción explícito: "opción 1", "opción 2", "opci 2"
- Número o nombre de unidad directamente: "801", "1201", "el 1201", "la 801", "la unidad 801"
- Frases de confirmación: "quiero esa", "esa misma", "me quedo con esa", "esa", "la segunda opción"
- Frases con verbo + referencia: "quiero la segunda", "prefiero la 1", "me quedo con la 3"

No selección (seleccion_explicita: false) — preguntas o comentarios sin elegir:
- "cuánto cuesta?", "tiene estacionamiento?", "¿hay en piso 5?", "muéstrame más opciones", "no me gusta ninguna"
- "qué incluye?", "cuál es la diferencia?", "tienen estacionamiento?"

REGLA CLAVE: Si el cliente usa un número (1-9) como referencia a la POSICIÓN de una opción en la lista (ej: "la 3", "a ver la 2"), eso ES selección explícita aunque no diga el número real de la unidad (ej: 801).

Mensaje del cliente: "${userMessage.trim()}"

Responde solo con el JSON requerido.`;

      const extractor = this.summaryExtractorLlm.withStructuredOutput(SeleccionSchema);
      const result = await extractor.invoke(prompt);
      return result.seleccion_explicita;
    } catch (err) {
      this.logger.warn(`hasExplicitUnitSelection LLM fallback: ${err.message}`);
      return false;
    }
  }

  private shouldForceFaqTool(userMessage: string, toolsEjecutados: string[]): boolean {
    if (!userMessage?.trim()) return false;
    if (toolsEjecutados.includes('buscar_preguntas_frecuentes')) {
      return false;
    }

    const normalized = this.normalizeText(userMessage);
    const faqPatterns = [
      /\bentrega\b/,
      /\bentrega inmediata\b/,
      /\bfecha de entrega\b/,
      /\bcuando entregan\b/,
      /\bubicacion\b/,
      /\bdireccion\b/,
      /\bdonde queda\b/,
      /\bhorario\b/,
      /\barea(s)? comunes\b/,
      /\bacabados\b/,
      /\bfinanciamiento\b/,
      /\bcuota\b/,
      /\bshowroom\b/,
      /\bsala de ventas\b/,
      /\brecorrido virtual\b/,
      /\btour virtual\b/,
      /\bexhibicion\b/,
      /\betapa\b/,
      /\bprecio\b/,
      /\bdisponibilidad\b/,
    ];

    return faqPatterns.some((pattern) => pattern.test(normalized));
  }

  private getBaseToolNamesByPaso(pasoPendiente: number, tieneCitaActiva = false): string[] {
    if (tieneCitaActiva) {
      return ['buscar_preguntas_frecuentes', 'guardar_proyecto', 'descartar_cliente', 'reagendar_cita', 'agendar_cita', 'enviar_brochure', 'enviar_videos_proyecto'];
    }

    if (pasoPendiente <= 5) {
      return ['buscar_preguntas_frecuentes', 'guardar_proyecto', 'descartar_cliente', 'enviar_brochure', 'enviar_videos_proyecto'];
    }

    if (pasoPendiente <= 7) {
      return ['buscar_departamento', 'enviar_plano_departamento', 'descartar_cliente'];
    }

    if (pasoPendiente <= 9) {
      return ['buscar_preguntas_frecuentes', 'guardar_proyecto', 'descartar_cliente', 'buscar_departamento', 'validar_dni', 'generar_proforma', 'enviar_brochure', 'enviar_videos_proyecto'];
    }

    return ['buscar_preguntas_frecuentes', 'guardar_proyecto', 'descartar_cliente', 'agendar_cita', 'reagendar_cita', 'enviar_brochure', 'enviar_videos_proyecto'];
  }

  private detectIntentToolNames(userMessage: string): string[] {
    const normalized = this.normalizeText(userMessage);
    const tools = new Set<string>();

    if (!normalized) {
      return [];
    }

    if (/\bbrochure\b|\bcatalogo\b|\bpdf\b/.test(normalized)) {
      tools.add('enviar_brochure');
    }

    if (/\bvideo(s)?\b|\brecorrido\b|\btour virtual\b/.test(normalized)) {
      tools.add('enviar_videos_proyecto');
      tools.add('buscar_preguntas_frecuentes');
    }

    if (/\bplano\b|\bfloor plan\b|\bdistribucion\b/.test(normalized)) {
      tools.add('enviar_plano_departamento');
      tools.add('buscar_departamento');
    }

    if (/\bubicacion\b|\bdireccion\b|\bdonde queda\b|\bmapa\b|\bgoogle maps\b|\bentrega\b|\bhorario\b|\bacabados\b|\barea(s)? comunes\b|\brecorrido virtual\b|\betapa\b/.test(normalized)) {
      tools.add('buscar_preguntas_frecuentes');
    }

    if (/\bdni\b|\bdocumento\b/.test(normalized) || /\b\d{8}\b/.test(normalized)) {
      tools.add('validar_dni');
    }

    if (/\bproforma\b|\bcotizacion\b|\bcotizar\b/.test(normalized)) {
      tools.add('generar_proforma');
    }

    if (/\bcita\b|\bagendar\b|\bagendamos\b|\bvisita\b|\breagendar\b|\bcambiar cita\b|\breprogramar\b/.test(normalized)) {
      tools.add('agendar_cita');
      tools.add('reagendar_cita');
    }

    if (/\bdepartamentos?\b|\bdepas?\b|\bunidades?\b|\bopciones?\b|\bdormitorios?\b|\bdorms?\b|\bcuartos?\b|\bpisos?\b|\bvista\b|\bprecio\b|\bunidad\b/.test(normalized)) {
      tools.add('buscar_departamento');
    }

    return Array.from(tools);
  }

  private getToolSubset(
    tools: DynamicStructuredTool[],
    pasoPendiente: number,
    tieneCitaActiva: boolean,
    userMessage: string,
  ): DynamicStructuredTool[] {
    const baseNames = this.getBaseToolNamesByPaso(pasoPendiente, tieneCitaActiva);
    const intentNames = this.detectIntentToolNames(userMessage);

   
    const BLOQUEADOS_EN_PRESENTACION = new Set(['enviar_brochure', 'enviar_videos_proyecto']);
    const enFasePresentacion = !tieneCitaActiva && pasoPendiente >= 6 && pasoPendiente <= 7;

    const filteredIntent = enFasePresentacion
      ? intentNames.filter(n => !BLOQUEADOS_EN_PRESENTACION.has(n))
      : intentNames;

    const toolNames = new Set<string>([...baseNames, ...filteredIntent]);

    const filtered = tools.filter((tool) => toolNames.has(tool.name));
    return filtered.length > 0 ? filtered : tools;
  }

  private extractDormitoriosForSearch(resumenSesion?: string): number | number[] | undefined {
    const parsed = parseSessionSummary(resumenSesion || '');
    const raw = parsed.dormitorios;
    if (!raw) return undefined;

    const values = raw
      .split(/\s+y\s+|,/i)
      .map((part) => Number(part.trim()))
      .filter((value) => !Number.isNaN(value));

    if (values.length === 0) return undefined;
    if (values.length === 1) return values[0];
    return values;
  }

  private extractPisoPreference(userMessage: string): 'altos' | 'bajos' | undefined {
    const normalized = this.normalizeText(userMessage);
    if (/\bpisos? altos?\b|\balto(s)?\b/.test(normalized)) {
      return 'altos';
    }
    if (/\bpisos? bajos?\b|\bbajo(s)?\b/.test(normalized)) {
      return 'bajos';
    }
    return undefined;
  }


  private hasCompletedDiscoveryForSearch(resumenSesion?: string): boolean {
    const parsed = parseSessionSummary(resumenSesion || '');
    return !!parsed.dormitorios && !!parsed.presupuesto;
  }


  private shouldForceDepartmentSearch(
    _promptConfig: AgentPromptConfig,
    metadata: {
      proyectoId?: number;
      resumenSesion?: string;
    },
    toolsEjecutados: string[],
    _historial: BaseMessage[],
    _mensajeUsuario: string,
  ): boolean {
    if (!metadata.proyectoId) return false;
    if (toolsEjecutados.includes('buscar_departamento')) return false;

    const dormitorios = this.extractDormitoriosForSearch(metadata.resumenSesion);
    if (dormitorios === undefined) return false;

    // Recomputar paso real desde el resumen fresco
    const parsed = parseSessionSummary(metadata.resumenSesion || '');

    if (parsed.pasoPendiente >= 6 && parsed.pasoPendiente <= 7) {
      return this.hasCompletedDiscoveryForSearch(metadata.resumenSesion);
    }

    return false;
  }

  private async registrarTokens(
    fase: 'main_chat' | 'summary_extract' | 'faq_llm' | 'lead_scoring',
    metadata: { leadUuid?: string; codigoEmpresa?: number },
    response: any,
    extra?: Record<string, any>,
  ): Promise<void> {
    const tokens = this.extraerTokens(response);
    if (!tokens) return;

    await this.tokenTrackingService.registrar({
      leadUuid: metadata.leadUuid,
      codigoEmpresa: metadata.codigoEmpresa,
      fase,
      modelo: response?.response_metadata?.model_name || this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini',
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      metadatos: extra,
    });
  }




  private async getTools(codigoEmpresa: number): Promise<DynamicStructuredTool[]> {
    const now = Date.now();
    const cached = this.toolsCache.get(codigoEmpresa);
    // Cache de 30 minutos (1800000 ms) para no consultar la BD en cada ejecución
    if (cached && cached.expiresAt > now) {
      return cached.tools;
    }

    let nombresProyectosStr = 'Ej: "Los Lirios", "porta", "los cerezos".';
    try {
      const proyectos = await this.proyectosRepo.find({
        select: ['nombre'],
        where: { codigoEmpresa, estado: 'activo' }
      });
      if (proyectos.length > 0) {
        const nombres = proyectos.map(p => `"${p.nombre}"`).join(', ');
        nombresProyectosStr = `Proyectos activos: ${nombres}.`;
      }
    } catch (e) {
      this.logger.warn(`No se pudieron cargar proyectos para tool descriptions: ${e.message}`);
    }

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
      description: 'MOTOR DE INFORMACIÓN: Úsala para CUALQUIER pregunta sobre: Ubicación/Entorno, Financiamiento/Bancos, Acabados, Áreas Comunes, Fechas de Entrega/Obra, Tipos de dpto (general) y Requisitos. Si el usuario pregunta por OTRO proyecto o compara proyectos, úsala igual. Responde sin cambiar el proyecto actual, salvo que el cliente confirme explícitamente que quiere cambiarse.',
      schema: z.object({
        queries_de_busqueda: z.array(z.string()).describe('Lista de preguntas o palabras clave'),
        nombre_proyecto: z.string().optional().describe('Nombre del proyecto solo si el usuario menciona explícitamente otro proyecto'),
      }),
      func: async (input, config) => {
        const metadata = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.buscarPreguntasFrecuentes(
          {
            ...input,
            codigoEmpresa: metadata.codigoEmpresa,
            leadUuid: metadata.leadUuid,
            proyectoIdSesion: metadata.proyectoId,
          },
          metadata.proyectoId
        );
        return result;
      },
    });

    // 3️    Validar DNI
    const validarDniTool = new DynamicStructuredTool({
      name: 'validar_dni',
      description: 'Valida que un DNI peruano sea válido (8 dígitos, no todo ceros) y lo guarda en el sistema.',
      schema: z.object({
        dni: z.string().describe('DNI capturado tal como lo escribió el cliente. No recortes ni transformes dígitos.'),
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
      description: 'Busca departamentos en inventario real. SOLO pasa el número de dormitorios (o array si pide varios). NUNCA pases el presupuesto/cuota del cliente como parámetro. SOLO úsala cuando ya estén completos los pasos 1-5 del flujo o cuando el cliente elija una unidad específica.',
      schema: z.object({
        unidad: z.string().optional().describe('Número de unidad específica (ej: "1003", "1701"). SOLO si el cliente la eligió explícitamente. NO inventes ni deduzcas una unidad desde la lista.'),
        dormitorios: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]).optional().describe('Cantidad de dormitorios (ej: 2, "monoambiente" o [2, "monoambiente"])'),
        piso: z.number().optional().describe('Piso específico (1-17)'),
        precio_max: z.number().optional().describe('Precio máximo en soles'),
        precio_min: z.number().optional().describe('Precio mínimo en soles'),
        vista: z.string().optional().describe('Vista: "exterior" o "interior"'),
        tipologia: z.string().optional().describe('Tipología: "Tipo 1", "Tipo 2", etc.'),
        tipo_unidad: z.string().optional().describe('Tipo de unidad: "Duplex" o "Flat". Usa cuando el cliente pide específicamente duplex o flat. SIEMPRE capitalizado.'),
        area_min: z.number().optional().describe('Área mínima en m²'),
        preferencia_piso: z.enum(['bajos', 'altos']).optional().describe('"bajos" si pide pisos bajos (ordena 1,2,3...), "altos" si pide pisos altos (ordena 17,16,15...)'),
        nombre_proyecto: z.string().optional().describe(`Nombre del proyecto si el cliente lo menciona en su consulta. ${nombresProyectosStr}`),
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
          nombre_proyecto: input.nombre_proyecto,
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
        nombre_proyecto: z.string().describe(`Nombre del proyecto que eligio o al que quiere cambiarse. ${nombresProyectosStr}`),
      }),
      func: async (input, config) => {
        const { codigoEmpresa, leadUuid, mensajeUsuarioOriginal } = (config as any)?.metadata || {};
        const result = await this.toolsExecutionService.guardarProyecto(
          {
            ...input,
            mensaje_usuario_original: mensajeUsuarioOriginal,
          },
          codigoEmpresa,
          leadUuid
        );
        return JSON.stringify(result);
      },
    });

    const tools = [
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

    this.toolsCache.set(codigoEmpresa, { tools, expiresAt: now + 1800000 });
    return tools;
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
    promptConfigOrSystemPrompt: string | AgentPromptConfig,
    mensajeUsuario: string,
    historial: BaseMessage[] = [],
    metadata: {
      codigoEmpresa: number;
      leadUuid: string;
      nombreLead?: string;
      proyectoInteres?: string;
      phoneNumber?: string;
      proyectoId?: number;
      pasoPendiente?: number;
      resumenSesion?: string;
      tieneCitaActiva?: boolean;
      resumenActualizado?: boolean;
      mensajeUsuarioOriginal?: string;
    }
  ): Promise<{
    output: string;
    tokensUsados?: { input: number; output: number };
    toolsEjecutados: string[];
  }> {
    try {
      this.logger.log(`Ejecutando agente para lead: ${metadata.leadUuid}`);

      if (!metadata.resumenActualizado) {
        await this.extraerYGuardarResumen(mensajeUsuario, metadata.leadUuid, metadata.codigoEmpresa);
      }

      const toolsEjecutados: string[] = [];
      let tokensAcumulados = { input: 0, output: 0 };

      const promptConfig: AgentPromptConfig = typeof promptConfigOrSystemPrompt === 'string'
        ? {
          stablePrompt: promptConfigOrSystemPrompt,
          variablePrompt: '',
          pasoPendiente: metadata.pasoPendiente || 1,
        }
        : promptConfigOrSystemPrompt;

      const allTools = await this.getTools(metadata.codigoEmpresa);
      const actTools = this.getToolSubset(
        allTools,
        promptConfig.pasoPendiente,
        !!metadata.tieneCitaActiva,
        mensajeUsuario
      );
      const modelWithTools = this.llm.bindTools(actTools);

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

      const timeContext = `CONTEXTO TEMPORAL PERU: hoy=${fechaISO}, manana=${fechaMananaISO}, hora_actual=${horaActual}, referencia="${fechaLegible}". Reglas: no agendes en pasado ni fuera de horario; si la fecha es ${fechaISO} di "hoy", si es ${fechaMananaISO} di "mañana".`;
      const systemMessages: BaseMessage[] = [
        { role: 'system', content: promptConfig.stablePrompt } as any,
      ];

      if (promptConfig.variablePrompt?.trim()) {
        systemMessages.push({ role: 'system', content: promptConfig.variablePrompt } as any);
      }

      systemMessages.push({ role: 'system', content: timeContext } as any);

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
          ...systemMessages,
          ...messages,
          { role: 'user', content: mensajeUsuario }
        ]);

        // Acumular tokens
        const tokens = this.extraerTokens(response);
        if (tokens) {
          tokensAcumulados.input += tokens.input;
          tokensAcumulados.output += tokens.output;
        }
        await this.registrarTokens('main_chat', metadata, response, {
          iteracion,
          pasoPendiente: promptConfig.pasoPendiente,
          toolsDisponibles: actTools.map(tool => tool.name),
          toolsEjecutados,
        });

        // Si NO hay tool_calls, esta es la respuesta final
        if (!response.tool_calls || response.tool_calls.length === 0) {
          if (this.shouldForceDepartmentSearch(promptConfig, metadata, toolsEjecutados, messages, mensajeUsuario)) {
            this.logger.warn('Respuesta sin tool_calls en fase de presentacion. Forzando buscar_departamento.');

            const dormitorios = this.extractDormitoriosForSearch(metadata.resumenSesion);
            const preferenciaPiso = this.extractPisoPreference(mensajeUsuario);

            const searchResult = await this.toolsExecutionService.buscarDepartamentoUniversal({
              dormitorios,
              preferencia_piso: preferenciaPiso,
              phoneNumber: metadata.phoneNumber,
              codigoEmpresa: metadata.codigoEmpresa,
              leadUuid: metadata.leadUuid,
              proyectoId: metadata.proyectoId,
            });

            toolsEjecutados.push('buscar_departamento');

            try {
              await this.historialChatService.guardarMensaje({
                leadUuid: metadata.leadUuid,
                codigoEmpresa: metadata.codigoEmpresa,
                mensaje: { role: 'function', content: `[buscar_departamento] ${searchResult}` },
                role: 'function',
                metadatos: {
                  toolName: 'buscar_departamento',
                  args: {
                    dormitorios,
                    preferencia_piso: preferenciaPiso,
                    proyectoId: metadata.proyectoId,
                  }
                }
              });
            } catch (histError) {
              this.logger.warn(`No se pudo guardar buscar_departamento forzada en historial: ${histError.message}`);
            }

            const forcedFinal = await this.llm.invoke([
              ...systemMessages,
              { role: 'system', content: 'El flujo exige mostrar unidades disponibles ahora. Usa el resultado de buscar_departamento para responder y listar hasta 3 unidades si existen, respetando el orden recibido. NO hagas preguntas opcionales previas. NO recomiendes una sola unidad ni ofrezcas plano o visita hasta que el cliente elija una. NO llames más herramientas.' },
              ...messages,
              { role: 'user', content: mensajeUsuario },
              { role: 'system', content: `Resultado de buscar_departamento:\n${searchResult}` }
            ]);

            const output = forcedFinal.content?.toString() || "No pude generar una respuesta.";
            const forcedTokens = this.extraerTokens(forcedFinal);
            if (forcedTokens) {
              tokensAcumulados.input += forcedTokens.input;
              tokensAcumulados.output += forcedTokens.output;
            }
            await this.registrarTokens('main_chat', metadata, forcedFinal, {
              iteracion,
              forced: true,
              tool: 'buscar_departamento',
              pasoPendiente: promptConfig.pasoPendiente,
            });

            return {
              output,
              tokensUsados: tokensAcumulados,
              toolsEjecutados,
            };
          }

          if (this.shouldForceFaqTool(mensajeUsuario, toolsEjecutados)) {
            this.logger.warn('Respuesta sin tool_calls para consulta FAQ. Forzando buscar_preguntas_frecuentes.');

            const faqResult = await this.toolsExecutionService.buscarPreguntasFrecuentes(
              {
                queries_de_busqueda: [mensajeUsuario],
                codigoEmpresa: metadata.codigoEmpresa,
                leadUuid: metadata.leadUuid,
                proyectoIdSesion: metadata.proyectoId,
              },
              metadata.proyectoId
            );

            toolsEjecutados.push('buscar_preguntas_frecuentes');

            try {
              await this.historialChatService.guardarMensaje({
                leadUuid: metadata.leadUuid,
                codigoEmpresa: metadata.codigoEmpresa,
                mensaje: { role: 'function', content: `[buscar_preguntas_frecuentes] ${faqResult}` },
                role: 'function',
                metadatos: { toolName: 'buscar_preguntas_frecuentes', args: { queries_de_busqueda: [mensajeUsuario] } }
              });
            } catch (histError) {
              this.logger.warn(`No se pudo guardar FAQ forzada en historial: ${histError.message}`);
            }

            const forcedFinal = await this.llm.invoke([
              ...systemMessages,
              { role: 'system', content: 'La consulta del usuario requería herramienta obligatoria. Usa el resultado de la herramienta para responder. NO inventes datos. NO llames más herramientas.' },
              ...messages,
              { role: 'user', content: mensajeUsuario },
              { role: 'system', content: `Resultado de herramienta obligatoria:\n${faqResult}` }
            ]);

            const output = forcedFinal.content?.toString() || "No pude generar una respuesta.";
            const forcedTokens = this.extraerTokens(forcedFinal);
            if (forcedTokens) {
              tokensAcumulados.input += forcedTokens.input;
              tokensAcumulados.output += forcedTokens.output;
            }
            await this.registrarTokens('main_chat', metadata, forcedFinal, {
              iteracion,
              forced: true,
              pasoPendiente: promptConfig.pasoPendiente,
            });

            this.logger.log(`Agente completado - Tools usados: ${toolsEjecutados.join(', ')}`);

            return {
              output,
              tokensUsados: tokensAcumulados,
              toolsEjecutados,
            };
          }

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
          let cerrarTurnoTrasBusquedaInicial = false;

          const HERRAMIENTAS_REPETIBLES = ['buscar_departamento'];

          // Verificar si la tool ya fue ejecutada en esta sesión
          if (accionesEjecutadas.has(toolCall.name) && !HERRAMIENTAS_REPETIBLES.includes(toolCall.name)) {
            this.logger.warn(`Tool ${toolCall.name} ya fue ejecutada, enviando mensaje de bloqueo`);
            toolResult = `[BLOQUEADO] La herramienta ${toolCall.name} ya fue ejecutada. Genera tu respuesta final con la información que ya tienes.`;
          } else if (HERRAMIENTAS_EXCLUYENTES[toolCall.name]?.some(excl => accionesEjecutadas.has(excl))) {
            const ejecutada = HERRAMIENTAS_EXCLUYENTES[toolCall.name].find(excl => accionesEjecutadas.has(excl));
            this.logger.warn(`[BLOQUEO MUTUO] ${toolCall.name} bloqueada porque ${ejecutada} ya se ejecutó`);
            toolResult = `[BLOQUEADO] No puedes usar ${toolCall.name} porque ya se ejecutó ${ejecutada}. Son herramientas mutuamente excluyentes. Usa la respuesta de ${ejecutada} para tu mensaje final.`;
          } else {
            try {
              // Encontrar tool
              const tool = actTools.find(t => t.name === toolCall.name);

              if (!tool) {
                throw new Error(`Tool '${toolCall.name}' no encontrada`);
              }

              if (
                toolCall.name === 'buscar_departamento' &&
                toolCall.args?.unidad &&
                !(await this.hasExplicitUnitSelection(mensajeUsuario, toolCall.args.unidad))
              ) {
                this.logger.warn(`Busqueda por unidad bloqueada por falta de eleccion explicita del cliente: ${toolCall.args.unidad}`);
                toolResult = '[BLOQUEADO] El cliente NO eligio una unidad de forma explicita en su ultimo mensaje. Usa el resultado previo de buscar_departamento para listar 2 o 3 opciones y pregúntale cuál prefiere. NO asumas una unidad. NO pidas nombre, DNI ni proforma todavía.';
                messages.push(
                  new ToolMessage({
                    tool_call_id: toolCall.id,
                    content: toolResult,
                  })
                );
                continue;
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

              if (
                toolCall.name === 'buscar_departamento' &&
                !toolCall.args?.unidad &&
                !(await this.hasExplicitUnitSelection(mensajeUsuario))
              ) {
                cerrarTurnoTrasBusquedaInicial = true;
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

          if (cerrarTurnoTrasBusquedaInicial) {
            const forcedFinal = await this.llm.invoke([
              ...systemMessages,
              { role: 'system', content: 'Acabas de recibir el resultado inicial de buscar_departamento. RESPONDE AHORA listando MAXIMO 3 opciones en el orden recibido. NO elijas una unidad por el cliente. NO pidas nombre, DNI, proforma ni visita. SOLO pregunta cual de esas opciones prefiere o si quiere ver otras alternativas. NO llames más herramientas.' },
              ...messages,
              { role: 'user', content: mensajeUsuario },
            ]);

            const output = forcedFinal.content?.toString() || 'No pude generar una respuesta.';
            const forcedTokens = this.extraerTokens(forcedFinal);
            if (forcedTokens) {
              tokensAcumulados.input += forcedTokens.input;
              tokensAcumulados.output += forcedTokens.output;
            }
            await this.registrarTokens('main_chat', metadata, forcedFinal, {
              iteracion,
              forced: true,
              tool: 'buscar_departamento_resultado_inicial',
              pasoPendiente: promptConfig.pasoPendiente,
            });

            return {
              output,
              tokensUsados: tokensAcumulados,
              toolsEjecutados,
            };
          }
        }

        // Continuar al siguiente loop - el modelo generará respuesta o pedirá más tools
      }

      // Si llegamos aquí, alcanzamos max iteraciones
      this.logger.warn(`Agente alcanzó máximo de iteraciones (${maxIteraciones})`);

      // Hacer una llamada final SIN tools para forzar respuesta de texto
      try {
        const finalResponse = await this.llm.invoke([
          ...systemMessages,
          { role: 'system', content: 'GENERA TU RESPUESTA FINAL AHORA. No llames más herramientas.' },
          ...messages,
        ]);

        const output = finalResponse.content?.toString() || "No pude generar una respuesta.";
        const finalTokens = this.extraerTokens(finalResponse);
        if (finalTokens) {
          tokensAcumulados.input += finalTokens.input;
          tokensAcumulados.output += finalTokens.output;
        }
        await this.registrarTokens('main_chat', metadata, finalResponse, {
          iteracion,
          forced: true,
          maxIteraciones,
          pasoPendiente: promptConfig.pasoPendiente,
        });

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

  async actualizarResumenSesion(
    mensaje: string,
    leadUuid: string,
    codigoEmpresa: number,
    options?: {
      omitirSiSeleccionProyectoNumerica?: boolean;
      nombresProyectosActivos?: string[];
    }
  ): Promise<void> {
    await this.extraerYGuardarResumen(mensaje, leadUuid, codigoEmpresa, options);
  }


  /**
   * Extrae información relevante del mensaje del usuario usando LLM
   * y la guarda en el resumen de conversación
   */
  private async extraerYGuardarResumen(
    mensaje: string,
    leadUuid: string,
    codigoEmpresa: number,
    options?: {
      omitirSiSeleccionProyectoNumerica?: boolean;
      nombresProyectosActivos?: string[];
    }
  ): Promise<void> {
    try {
      if (options?.omitirSiSeleccionProyectoNumerica && /^\s*\d{1,2}\s*$/.test(mensaje || '')) {
        this.logger.debug('Resumen omitido por seleccion numerica ambigua de proyecto.');
        return;
      }

      const resumenActual = await this.resumenService.obtenerResumen(leadUuid, codigoEmpresa);
      const contextoActual = parseSessionSummary(resumenActual || '');
      const nombresProyectosActivosNormalizados = new Set(
        (options?.nombresProyectosActivos || []).map((nombre) => this.normalizeText(nombre)),
      );

      // Schema para extracción estructurada
      const InfoResumenSchema = z.object({
        dormitorios: z.array(z.number()).describe('Lista de cantidad de dormitorios mencionados (ej: [2, 3]). Si no hay, array vacio.'),
        proposito: z.enum(['vivir', 'inversion', 'mix_uso']).nullable().describe('Propósito de compra si se menciona. Null si no hay.'),
        zonas: z.array(z.string()).describe('Distritos o zonas de interés mencionados. Si no hay, array vacios.'),
        tiempo_compra: z.string().nullable().describe('Tiempo estimado de compra (ej: "este mes", "2026", "pronto"). Null si no hay.'),
        financiamiento: z.enum(['hipotecario', 'banco', 'directo', 'contado']).nullable().describe('Tipo de financiamiento mencionado. Null si no hay.'),
        presupuesto: z.string().nullable().describe('Presupuesto o cuota mencionada (ej: "500k", "cuota 3000"). Null si no hay.'),
        ingresos: z.string().nullable().describe('Ingresos mensuales del cliente. MANTÉN RANGOS si existen (ej: "5000-6000", "5k a 6k"). Null si no hay.'),
        nombre_completo: z.string().nullable().describe('Nombre completo real del cliente si lo proporciona en el mensaje. Null si no hay.'),
        dni: z.string().nullable().describe('DNI de 8 dígitos si aparece. Null si no hay.'),
        email: z.string().nullable().describe('Correo electrónico si aparece. Null si no hay.'),
        ocupacion: z.string().nullable().describe('Ocupación o profesión del cliente si la menciona. Null si no hay.'),
        unidad_interes: z.string().nullable().describe('Unidad específica si el cliente menciona una (ej: "1003", "A-602"). Null si no hay.'),
        intereses_adicionales: z.array(z.string()).describe('Temas adicionales: estacionamiento, mascota, entrega, areas_comunes, inicial. Si no hay, array vacio.'),
      });

      const prompt = `
      Eres un extractor de datos de conversaciones inmobiliarias en Perú. Analiza el mensaje del cliente y extrae TODOS los datos útiles que puedas encontrar. Un solo mensaje puede contener múltiples datos de distintas categorías.

      El cliente puede escribir con errores tipográficos, abreviaciones, jerga peruana o de forma muy casual. SIEMPRE interpreta la intención real aunque haya errores. Este resumen es la FUENTE PRINCIPAL de continuidad del flujo.

      CONTEXTO DE SESIÓN ACTUAL:
      - Paso actual del flujo: ${contextoActual.pasoPendiente}
      - Dormitorios ya registrados: ${contextoActual.dormitorios || 'ninguno'}
      - Zona ya registrada: ${contextoActual.zonaPreferida || 'ninguna'}
      - Presupuesto ya registrado: ${contextoActual.presupuesto || 'ninguno'}

      DORMITORIOS — cuántos cuartos/habitaciones busca el cliente

      Extrae si el cliente describe cuántos dormitorios quiere. Acepta CUALQUIER forma de decirlo:
      "1 dorm", "dos cuartos", "tres habitaciones", "3 ambientes", "una", "de 2", "quiero 2",
      "busco de 3", "dijiste de 2", "2 dormis", "dos", "quiero un depa de 2", "con 2", etc.

      EXCEPCIÓN POSICIONAL: Si el paso actual es >= 6 (ya se mostró inventario), los dormitorios ya están capturados.
      Un número suelto como "la 2", "la primera", "a ver la 3", "opción 2" es UNA ELECCIÓN DE LISTA → array vacío.
      Ejemplos:
      * "1" (paso 1) → dormitorios: [1]
      * "dos" (paso 1) → dormitorios: [2]
      * "de 2" (paso 1) → dormitorios: [2]
      * "busco de tres cuartos" → dormitorios: [3]
      * "quiero 2 o 3 dormitorios" → dormitorios: [2, 3]
      * "a ver la 2" (paso 6+) → dormitorios: []
      * "la primera" (paso 6+) → dormitorios: []


      PRESUPUESTO — cuota mensual o monto que puede pagar

      Extrae si el cliente menciona un monto, aunque el mensaje sea corto o tenga errores. Acepta cualquier variante:
      * "400" (paso 5) → presupuesto: "400 soles"
      * "S/1200" → presupuesto: "1200 soles"
      * "unos 800 al mes" → presupuesto: "800 soles mensuales"
      * "puedo 1500" → presupuesto: "1500 soles"
      * "maximo 2000" → presupuesto: "2000 soles"
      * "3k de cuota" → presupuesto: "3k"
      * "mi cuota seria de 900" → presupuesto: "900 soles cuota"
      * "tengo como 500" → presupuesto: "500 soles"
      * "no mas de 1000" → presupuesto: "1000 soles"
      * "presupueto 600" (typo) → presupuesto: "600 soles"
      * "manejaría hasta 1500" → presupuesto: "1500 soles"
      * "mi cuota eria 700" (typo) → presupuesto: "700 soles cuota"
      * "podria pagar unos 2500" → presupuesto: "2500 soles"
      * "con 2000 al mes" → presupuesto: "2000 soles mensuales"


      FINANCIAMIENTO — cómo pagará el departamento

      - "hipotecario" → hipotecario: crédito hipotecario, banco, via banco, crédito, bbva, scotiabank, bcp, interbank, Mivivienda, Techo Propio, "con el banco", "crédito bancario"
      - "directo" → directo con la empresa: con Checor, con ustedes, con la inmobiliaria, con la constructora, financiamiento propio, financiado por ustedes, financiamiento directo, "directo"
      - "contado" → al contado, al cash, de contado, pago total, efectivo, "pago todo"


      PROPÓSITO — para qué quiere el depa

      - "vivir": para vivir, para mi familia, para mudarme, vivienda, para mi, para residencia
      - "inversion": inversión, invertir, rentar, alquilar, arrendar, para negocio, para pasivo
      - "mix_uso": los dos, vivir y rentar, para vivir/invertir, uso mixto

      
      TIEMPO DE COMPRA — cuándo planea comprar

      Acepta cualquier forma: "este año", "en 6 meses", "pronto", "ahorita", "ya", "para diciembre",
      "a fin de año", "no sé todavía", "en un año", "a largo plazo", "cuando pueda", "próximo año".


      ZONA / DISTRITO — dónde quiere el depa

      Extrae distritos o zonas de Lima u otras ciudades peruanas. NO confundas con nombres de proyectos inmobiliarios.
      OTROS CAMPOS
      - nombre_completo: si el cliente dice sus nombres o datos 
      - dni: 8 dígitos consecutivos que el cliente mencione como DNI.
      - email: correo electrónico si lo proporciona.
      - ocupacion: profesión u oficio. Ej: "soy enfermera", "trabajo en construcción", "ingeniero civil".
      - ingresos: sueldo o ingresos mensuales. Mantén rangos exactos. Ej: "5000-6000", "entre 3k y 4k", "unos 4500".
      - unidad_interes: número o código de unidad específica si el cliente la menciona. Ej: "la 1003", "unidad 802", "A-602".
      - intereses_adicionales: temas adicionales detectados (estacionamiento, mascota, fecha de entrega, areas_comunes, cuota inicial).

      Si no encuentras información de un campo, déjalo vacío/null. Ignora saludos, gracias, emojis y texto sin datos útiles.

      Mensaje del cliente: "${mensaje}"
      `;

      let result: any;
      try {
        const extractorWithRaw = (this.summaryExtractorLlm as any).withStructuredOutput(InfoResumenSchema, { includeRaw: true });
        const response = await extractorWithRaw.invoke(prompt);
        result = response?.parsed ?? response;

        if (response?.raw) {
          await this.registrarTokens('summary_extract', { leadUuid, codigoEmpresa }, response.raw, {
            resumen: true,
          });
        }
      } catch {
        const extractor = this.summaryExtractorLlm.withStructuredOutput(InfoResumenSchema);
        result = await extractor.invoke(prompt);
      }

      await this.sincronizarDatosLeadExtraidos(leadUuid, codigoEmpresa, result);

      const puntos: string[] = [];
      const zonasDetectadas = (result.zonas || []).filter((zona: string) => {
        const zonaNormalizada = this.normalizeText(zona);
        return zonaNormalizada.length > 0 && !nombresProyectosActivosNormalizados.has(zonaNormalizada);
      });

      // Mapear resultados a formato de resumen
      if (result.dormitorios && result.dormitorios.length > 0) {
        const dormsStr = result.dormitorios.sort().join(' y ');
        this.addSummaryPoint(puntos, `Paso 1 - Dormitorios: ${dormsStr}`);
      }

      if (result.proposito) {
        const mapa: Record<string, string> = { 'vivir': 'para vivir', 'inversion': 'inversión', 'mix_uso': 'uso mixto' };
        this.addSummaryPoint(puntos, `Paso 2 - Proposito: ${mapa[result.proposito] || result.proposito}`);
      }

      if (zonasDetectadas.length > 0) {
        // Capitalizar
        const zonasCap = zonasDetectadas.map(z => z.charAt(0).toUpperCase() + z.slice(1).toLowerCase()).join(', ');
        this.addSummaryPoint(puntos, `Paso 2 - Zona preferida: ${zonasCap}`);
      }

      if (result.tiempo_compra) {
        this.addSummaryPoint(puntos, `Paso 3 - Tiempo de compra: ${result.tiempo_compra}`);
      }

      if (result.financiamiento) {
        const mapa: Record<string, string> = {
          'hipotecario': 'crédito hipotecario',
          'banco': 'crédito hipotecario',
          'directo': 'directo con Checor',
          'contado': 'al contado'
        };
        this.addSummaryPoint(puntos, `Paso 4 - Financiamiento: ${mapa[result.financiamiento] || result.financiamiento}`);
      }

      if (result.presupuesto) {
        this.addSummaryPoint(puntos, `Paso 5 - Presupuesto/Cuota: ${result.presupuesto}`);
      }

      if (result.unidad_interes) {
        this.addSummaryPoint(puntos, `Paso 6 - Unidad de interes: ${result.unidad_interes}`);
      }

      if (result.ocupacion) {
        this.addSummaryPoint(puntos, `Paso 9 - Ocupación: ${result.ocupacion}`);
      }

      if (result.ingresos) {
        this.addSummaryPoint(puntos, `Paso 9 - Ingresos mensuales: ${result.ingresos}`);
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
          if (key) this.addSummaryPoint(puntos, mapaInteres[key]);
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
