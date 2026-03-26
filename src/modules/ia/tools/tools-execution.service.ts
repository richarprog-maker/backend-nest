import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CitasService } from '../../citas/citas.service';
import { ConfigService } from '@nestjs/config';
import { QdrantVectorService } from '../qdrant-vector.service';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ProjectsSearchService } from '../projects-search.service';
import { WapiService } from '../../webhook_meta/wapi.service';
import { InboxService } from '../../inbox/inbox.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { SesionConversacion } from '../entities/sesion-conversacion.entity';
import { HistorialClasificacionLead } from '../../clasificacion-leads/entities/historial-clasificacion-lead.entity';
import { Lead } from '../../inbox/entities/lead.entity';
import { ResumenConversacionService } from '../resumen-conversacion.service';
import { Proyecto } from '../../proyectos/entities/proyecto.entity';
import { ColeccionQdrant } from '../../proyectos/entities/coleccion-qdrant.entity';
import { ServicioSperantService } from '../../sperant/services/servicio-sperant.service';
import {
    buildFaqContext,
    FaqDocumentResult,
    isFaqMultiProjectQuery,
    normalizeToolText,
    resolveMentionedProjects
} from './utils/faq-project.utils';
import { convertGoogleDriveToDirectUrl, formatMonto } from './utils/tool-format.utils';
import { parseSessionSummary, resolvePasoPendiente } from '../utils/session-summary.utils';
import { TokenTrackingService } from '../token-tracking.service';

@Injectable()
export class ToolsExecutionService {
    private readonly logger = new Logger(ToolsExecutionService.name);
    private llm: ChatOpenAI;
    private cacheColecciones: Map<string, string> = new Map();

    constructor(
        private citasService: CitasService,
        private configService: ConfigService,
        private qdrantVectorService: QdrantVectorService,
        private projectsSearchService: ProjectsSearchService,
        private wapiService: WapiService,
        private inboxService: InboxService,
        @InjectRepository(SesionConversacion) private sesionRepo: Repository<SesionConversacion>,
        @InjectRepository(HistorialClasificacionLead) private clasificacionRepo: Repository<HistorialClasificacionLead>,
        @InjectRepository(Lead) private leadRepo: Repository<Lead>,
        @InjectRepository(Proyecto) private proyectosRepo: Repository<Proyecto>,
        @InjectRepository(ColeccionQdrant) private coleccionQdrantRepo: Repository<ColeccionQdrant>,
        private resumenService: ResumenConversacionService,
        private servicioSperant: ServicioSperantService,
        private tokenTrackingService: TokenTrackingService,
    ) {
        this.llm = new ChatOpenAI({
            modelName: 'gpt-4o-mini',
            temperature: 0,
            openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
        });
    }

    private extractTokens(result: any): { input: number; output: number } | undefined {
        const usage = result?.usage_metadata || result?.response_metadata?.usage;

        if (!usage) {
            return undefined;
        }

        return {
            input: usage.prompt_tokens || usage.input_tokens || 0,
            output: usage.completion_tokens || usage.output_tokens || 0,
        };
    }

    private isValidDni(dni?: string | null): boolean {
        if (!dni) return false;
        const normalized = dni.trim();
        return /^\d{8}$/.test(normalized) && normalized !== '00000000' && !normalized.startsWith('00');
    }

    private async registrarTokensFaq(
        leadUuid: string | undefined,
        codigoEmpresa: number | undefined,
        response: any,
        metadatos?: any,
    ): Promise<void> {
        const tokens = this.extractTokens(response);
        if (!tokens) return;

        await this.tokenTrackingService.registrar({
            leadUuid,
            codigoEmpresa,
            fase: 'faq_llm',
            modelo: response?.response_metadata?.model_name || 'gpt-4o-mini',
            inputTokens: tokens.input,
            outputTokens: tokens.output,
            metadatos,
        });
    }

    private getFaqDirectResponse(
        docs: FaqDocumentResult[],
        modoBusqueda: 'active_only' | 'project_only' | 'multi_project',
    ): string | null {
        if (docs.length === 0) {
            return null;
        }

        if (modoBusqueda === 'multi_project') {
            return null;
        }

        const uniqueProjects = new Set(docs.map((doc) => doc.proyectoId));
        if (uniqueProjects.size !== 1) {
            return null;
        }

        const buildAnswerFromDoc = (doc: FaqDocumentResult): string | null => {
            const meta = doc.document.metadata || {};
            const answer = (meta.respuesta || meta.answer || meta.content || doc.document.pageContent || '').toString().trim();
            return answer || null;
        };

        if (docs.length === 1 && docs[0].score >= 0.85) {
            return buildAnswerFromDoc(docs[0]);
        }

        if (docs.length <= 2 && docs.every((doc) => doc.score >= 0.78)) {
            const answers = docs
                .map((doc) => buildAnswerFromDoc(doc))
                .filter((value): value is string => !!value && value.length <= 420);

            if (answers.length === docs.length) {
                return answers.join('\n\n');
            }
        }

        return null;
    }

    /**
     * Auto-sincroniza el proyecto de la sesión cuando una herramienta
     * usa un nombre_proyecto diferente al que tiene la sesión actual.
     */
    async sincronizarProyectoSesion(
        nombreProyecto: string,
        codigoEmpresa: number,
        leadUuid: string
    ): Promise<void> {
        try {
            if (!nombreProyecto?.trim()) return;

            const proyecto = await this.proyectosRepo.findOne({
                where: { nombre: ILike(`%${nombreProyecto.trim()}%`), codigoEmpresa }
            });

            if (!proyecto) return;

            const sesion = await this.sesionRepo.findOne({
                where: { leadUuid, codigoEmpresa }
            });

            if (!sesion) return;

            // Solo actualizar si el proyecto es diferente al actual
            if (sesion.proyectoId !== proyecto.id) {
                const proyectoAnteriorId = sesion.proyectoId;
                sesion.proyectoId = proyecto.id;
                await this.sesionRepo.save(sesion);
                this.logger.log(
                    `[SyncProyecto] Sesión actualizada: proyecto ${proyectoAnteriorId} -> ${proyecto.id} (${proyecto.nombre}) para lead ${leadUuid}`
                );
            }
        } catch (error) {
            this.logger.warn(`[SyncProyecto] Error sincronizando proyecto: ${error.message}`);
        }
    }

    async sincronizarProyectoSesionPorId(
        proyectoId: number,
        codigoEmpresa: number,
        leadUuid: string,
        origen: string = 'tool'
    ): Promise<void> {
        try {
            if (!proyectoId || !codigoEmpresa || !leadUuid) {
                return;
            }

            const sesion = await this.sesionRepo.findOne({
                where: { leadUuid, codigoEmpresa }
            });

            if (!sesion) {
                return;
            }

            if (sesion.proyectoId === proyectoId) {
                return;
            }

            const proyecto = await this.proyectosRepo.findOne({
                where: { id: proyectoId, codigoEmpresa, estado: 'activo' }
            });

            if (!proyecto) {
                return;
            }

            const proyectoAnteriorId = sesion.proyectoId;
            sesion.proyectoId = proyecto.id;
            await this.sesionRepo.save(sesion);

            this.logger.log(
                `[SyncProyectoById][${origen}] Sesión actualizada: proyecto ${proyectoAnteriorId} -> ${proyecto.id} (${proyecto.nombre}) para lead ${leadUuid}`
            );
        } catch (error) {
            this.logger.warn(`[SyncProyectoById][${origen}] Error sincronizando proyecto: ${error.message}`);
        }
    }

    async obtenerColeccionFaq(proyectoId: number): Promise<string> {
        if (!proyectoId) {
            throw new Error('PROYECTO_NO_SELECCIONADO');
        }
        const cacheKey = `faq-${proyectoId}`;
        if (this.cacheColecciones.has(cacheKey)) return this.cacheColecciones.get(cacheKey);
        try {
            const col = await this.coleccionQdrantRepo.findOne({
                where: { idProyecto: proyectoId, tipoColeccion: 'faq', estado: 'activo' }
            });
            if (!col) {
                // Si existe el proyecto pero no tiene colección específica, retornamos el default format
                return `checor-faq-${proyectoId}`;
            }
            const nombre = col.nombreColeccion;
            this.cacheColecciones.set(cacheKey, nombre);
            return nombre;
        } catch {
            return `checor-faq-${proyectoId}`;
        }
    }

    async obtenerColeccionInventario(proyectoId: number): Promise<string> {
        if (!proyectoId) {
            throw new Error('PROYECTO_NO_SELECCIONADO');
        }
        const cacheKey = `inventario-${proyectoId}`;
        if (this.cacheColecciones.has(cacheKey)) return this.cacheColecciones.get(cacheKey);
        try {
            const col = await this.coleccionQdrantRepo.findOne({
                where: { idProyecto: proyectoId, tipoColeccion: 'inventario', estado: 'activo' }
            });
            if (!col) {
                return `checor-inventory-${proyectoId}`;
            }
            const nombre = col.nombreColeccion;
            this.cacheColecciones.set(cacheKey, nombre);
            return nombre;
        } catch {
            return `checor-inventory-${proyectoId}`;
        }
    }

    private async obtenerProyectosActivosOrdenados(codigoEmpresa: number): Promise<Proyecto[]> {
        if (!codigoEmpresa) {
            return [];
        }

        return this.proyectosRepo.find({
            where: { codigoEmpresa, estado: 'activo' },
            order: { id: 'ASC' }
        });
    }

    private async buscarDocumentosFaq(
        query: string,
        proyectosObjetivo: Proyecto[],
        limitePorProyecto: number
    ): Promise<FaqDocumentResult[]> {
        const resultados = await Promise.all(proyectosObjetivo.map(async (proyecto) => {
            const collectionName = await this.obtenerColeccionFaq(proyecto.id);

            try {
                const docsConScore = await this.qdrantVectorService.similaritySearchWithScore(
                    collectionName,
                    query,
                    limitePorProyecto
                );

                return docsConScore.map(([document, score]) => ({
                    document,
                    score,
                    proyectoId: proyecto.id,
                    nombreProyecto: proyecto.nombre,
                    collectionName
                }));
            } catch (error) {
                this.logger.warn(
                    `[FAQ] Error buscando en colección ${collectionName} del proyecto ${proyecto.nombre}: ${error.message}`
                );
                return [];
            }
        }));

        const dedupe = new Map<string, FaqDocumentResult>();

        for (const batch of resultados) {
            for (const item of batch) {
                const key = `${item.proyectoId}::${normalizeToolText(item.document.pageContent || '')}`;
                const current = dedupe.get(key);
                if (!current || item.score > current.score) {
                    dedupe.set(key, item);
                }
            }
        }

        return Array.from(dedupe.values()).sort((a, b) => b.score - a.score);
    }


    async obtenerIdProyectoPorNombre(nombreProyecto: string, codigoEmpresa: number): Promise<number | null> {
        if (!nombreProyecto?.trim()) return null;
        try {
            const proyecto = await this.proyectosRepo.findOne({
                where: { nombre: ILike(`%${nombreProyecto.trim()}%`), codigoEmpresa, estado: 'activo' }
            });
            return proyecto ? proyecto.id : null;
        } catch (error) {
            this.logger.error(`Error buscando proyecto por nombre: ${error.message}`);
            return null;
        }
    }

    private async resolverProyectoPorSeleccion(
        seleccion: string | undefined,
        codigoEmpresa: number
    ): Promise<Proyecto | null> {
        const limpio = normalizeToolText(seleccion || '');
        if (!limpio) {
            return null;
        }

        const proyectos = await this.obtenerProyectosActivosOrdenados(codigoEmpresa);
        if (proyectos.length === 0) {
            return null;
        }

        const ordinalMap: Record<string, number> = {
            '1': 0,
            'uno': 0,
            'primer': 0,
            'primero': 0,
            '2': 1,
            'dos': 1,
            'segundo': 1,
            'segunda': 1,
            '3': 2,
            'tres': 2,
            'tercero': 2,
            'tercera': 2,
            '4': 3,
            'cuatro': 3,
            'cuarto': 3,
            'cuarta': 3,
        };

        const exactIndex = ordinalMap[limpio];
        if (exactIndex !== undefined && proyectos[exactIndex]) {
            return proyectos[exactIndex];
        }

        const numberMatch = limpio.match(/\b(\d{1,2})\b/);
        if (numberMatch) {
            const index = Number(numberMatch[1]) - 1;
            if (index >= 0 && index < proyectos.length) {
                return proyectos[index];
            }
        }

        return null;
    }

    async guardarProyecto(params: { nombre_proyecto: string; mensaje_usuario_original?: string }, codigoEmpresa: number, leadUuid: string): Promise<any> {
        try {
            const nombre = params.nombre_proyecto?.trim();
            if (!nombre) {
                return { success: false, mensaje: 'No se proporciono nombre de proyecto.' };
            }

            let proyecto = await this.proyectosRepo.findOne({
                where: { nombre: ILike(`%${nombre}%`), codigoEmpresa }
            });

            if (!proyecto) {
                proyecto = await this.resolverProyectoPorSeleccion(params.mensaje_usuario_original || nombre, codigoEmpresa);
            }

            if (!proyecto) {
                return { success: false, mensaje: `No se encontro un proyecto con el nombre "${nombre}".` };
            }

            let sesion = await this.sesionRepo.findOne({
                where: { leadUuid, codigoEmpresa }
            });

            const proyectoAnteriorId = sesion?.proyectoId || null;
            const esCambio = proyectoAnteriorId !== null && proyectoAnteriorId !== proyecto.id;

            if (sesion) {
                sesion.proyectoId = proyecto.id;
                await this.sesionRepo.save(sesion);
            } else {
                const lead = await this.leadRepo.findOne({ where: { uuid: leadUuid, codigoEmpresa } });
                sesion = this.sesionRepo.create({
                    leadUuid,
                    codigoEmpresa,
                    numeroTelefono: lead?.telefono || '',
                    proyectoId: proyecto.id,
                    idEstado: 1,
                    proximoMensajeMinutos: 60,
                    fechaHoraUltimoMsj: new Date(),
                });
                await this.sesionRepo.save(sesion);
            }

            this.logger.log(`Proyecto ${proyecto.nombre} (ID: ${proyecto.id}) asignado a lead ${leadUuid}`);

            // Determinar paso pendiente usando el resumen de sesion
            let instruccionContinuacion = '';
            if (esCambio) {
                const resumen = parseSessionSummary(sesion?.resumenConversacion || '');
                const lead = await this.leadRepo.findOne({ where: { uuid: leadUuid, codigoEmpresa } });
                const pasoPendiente = resolvePasoPendiente(resumen, lead || undefined, { proyectoId: proyecto.id });
                instruccionContinuacion = ` <<INSTRUCCION_IA: El cliente acaba de cambiarse al proyecto "${proyecto.nombre}". Los datos de fases previas (dormitorios, proposito, zona, tiempo de compra, financiamiento, presupuesto) son VALIDOS para este nuevo proyecto. Los datos personales validados se leen desde DATOS DEL CLIENTE. NO vuelvas a preguntar datos ya capturados. Continua directamente desde el PASO ${pasoPendiente} del flujo. Si el paso es 6 y ya tienes dormitorios, busca departamentos en "${proyecto.nombre}" usando esos dormitorios del resumen.>>`;
            }

            return {
                success: true,
                mensaje: `[ACCION_COMPLETADA] Proyecto "${proyecto.nombre}" registrado correctamente.${instruccionContinuacion}`,
                proyectoId: proyecto.id,
                nombreProyecto: proyecto.nombre
            };
        } catch (error) {
            this.logger.error(`Error guardando proyecto: ${error.message}`);
            return { success: false, mensaje: 'Error al guardar el proyecto.' };
        }
    }

    /**
     * Actualiza datos del lead SOLO si los campos están vacíos
     * Previene sobrescribir información existente
     * @param leadUuid UUID del lead
     * @param codigoEmpresa Código de empresa
     * @param datos Datos a actualizar (solo se actualizan campos vacíos)
     */
    private async actualizarLeadSeguro(
        leadUuid: string,
        codigoEmpresa: number,
        datos: {
            nombre?: string;
            apellido?: string;
            dni?: string;
            email?: string;
        }
    ): Promise<void> {
        try {
            // 1. Obtener lead actual
            const lead = await this.leadRepo.findOne({
                where: { uuid: leadUuid, codigoEmpresa }
            });

            if (!lead) {
                this.logger.warn(`Lead no encontrado: ${leadUuid}`);
                return;
            }

            // 2. Construir objeto de actualización
            // nombre/apellido: siempre sobrescribir si viene dato nuevo (nombre real del cliente)
            // dni/email: solo si está vacío (previene sobrescritura accidental)
            const updateData: any = {};

            if (datos.nombre) {
                updateData.nombre = datos.nombre.trim();
            }

            if (datos.apellido) {
                updateData.apellido = datos.apellido.trim();
            }

            if (datos.dni && !this.isValidDni(lead.dni)) {
                if (this.isValidDni(datos.dni)) {
                    updateData.dni = datos.dni.trim();
                } else {
                    this.logger.warn(`DNI descartado por formato invalido para lead ${leadUuid}: ${datos.dni}`);
                }
            }

            if (datos.email && !lead.email) {
                updateData.email = datos.email.trim().toLowerCase();
            }

            // 3. Actualizar solo si hay cambios
            if (Object.keys(updateData).length > 0) {
                await this.leadRepo.update(
                    { uuid: leadUuid, codigoEmpresa },
                    updateData
                );
            } else {
                this.logger.debug(`ℹ Lead ${leadUuid} ya tiene todos los datos proporcionados, no se actualiza`);
            }
        } catch (error) {
            this.logger.error(`Error actualizando lead seguro: ${error.message}`);
            // No lanzamos error para no interrumpir el flujo
        }
    }

    /*
     * Nueva herramienta inteligente para búsqueda de propiedades
     * Integra análisis de requisitos y búsqueda híbrida
     */
    async buscarPropiedadesInteligente(params: { input_usuario: string }, context?: any) {
        try {
            this.logger.log(`🔍 Búsqueda Inteligente: "${params.input_usuario}"`);

            // Usamos el servicio especializado
            const resultado = await this.projectsSearchService.searchProperties(
                params.input_usuario,
                5, // Limit 5
                context
            );

            const { results, filters_applied } = resultado;

            if (results.length === 0) {
                return "[ACCION_COMPLETADA] No encontre propiedades con esas caracteristicas especificas. <<INSTRUCCION_IA: Pregunta si quiere ver otras opciones similares.>>";
            }

            // Formatear respuesta para el LLM final
            const contextText = results.map((d: any, i: number) => {
                const m = d.metadata;
                // Validacion temporal para promos
                const fechaLimite = new Date('2025-01-01');
                const mostrarPromos = new Date() < fechaLimite;

                let precioStr = `- Precio: ${m.currency || 'S/'} ${m.price_list}`;
                if (mostrarPromos && m.price_promo) {
                    precioStr = `- Precio: ${m.currency || 'S/'} ${m.price_promo} (Antes: ${m.price_list})`;
                }

                return `OPCION ${i + 1}:
- Proyecto: ${m.project_name}
- Unidad: ${m.unit_number} (${m.type || 'Depa'})
${precioStr}
- Dormitorios: ${m.bedrooms}
- Piso: ${m.floor} (${m.view})
- Area: ${m.area_total}m2
- Disponibilidad: ${m.availability}
- Link Plano: ${m.url_plano}
- Ubicacion: ${m.url_ubicacion}
`;
            }).join('\n');

            return `[ACCION_COMPLETADA] Encontre estas opciones que coinciden con tu busqueda (Filtros: ${JSON.stringify(filters_applied)}):\n\n${contextText}`;

        } catch (error) {
            this.logger.error(`Error en búsqueda inteligente: ${error.message}`);
            return "Tuve un problema buscando las propiedades. Por favor intenta de nuevo.";
        }
    }

    /**
     * Valida fecha y hora para agendamiento de citas
     * Retorna objeto con {valid: boolean, mensaje?: string}
     */
    private validarFechaHoraCita(fecha_cita: string, hora_cita: string, horario_atencion?: any): { valid: boolean; mensaje?: string } {
        const ahoraPeru = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
        const hoyISO = `${ahoraPeru.getFullYear()}-${String(ahoraPeru.getMonth() + 1).padStart(2, '0')}-${String(ahoraPeru.getDate()).padStart(2, '0')}`;

        // 1. Validar que la fecha no sea pasada
        if (fecha_cita < hoyISO) {
            return {
                valid: false,
                mensaje: `La fecha ${fecha_cita} ya pasó. Solo puedo agendar citas para hoy o fechas futuras.`
            };
        }

        // 2. Si es hoy, validar que la hora no haya pasado (margen de 0 min)
        if (fecha_cita === hoyISO) {
            const horaActualMin = ahoraPeru.getHours() * 60 + ahoraPeru.getMinutes();
            const [hCita, mCita] = hora_cita.split(':').map(Number);
            const horaCitaMin = hCita * 60 + mCita;

            if (horaCitaMin < horaActualMin) {
                const horaActualStr = `${String(ahoraPeru.getHours()).padStart(2, '0')}:${String(ahoraPeru.getMinutes()).padStart(2, '0')}`;
                return {
                    valid: false,
                    mensaje: `La hora ${hora_cita} ya pasó (ahora son las ${horaActualStr}). Elige una hora a partir de las ${horaActualStr} en adelante.`
                };
            }
        }

        // 3. Validar horario de atención dinámico del proyecto
        let horariosArray: any[] = [];
        if (horario_atencion) {
            try {
                horariosArray = typeof horario_atencion === 'string' ? JSON.parse(horario_atencion) : horario_atencion;
                if (!Array.isArray(horariosArray)) {
                    horariosArray = [horariosArray];
                }
            } catch (e) {
                this.logger.warn(`Error parseando horario_atencion: ${e.message}`);
                horariosArray = [];
            }
        }

        if (horariosArray.length === 0) {
            this.logger.warn(`No hay horario_atencion configurado para este proyecto. Se omitirá la validación de horas.`);
            return { valid: true };
        }

        // Obtener día de la semana de la fecha solicitada de manera local o neutra
        const dateObj = new Date(`${fecha_cita}T12:00:00Z`);
        const diaSemana = dateObj.getUTCDay(); // 0 Dom, 1 Lun, 2 Mar... 6 Sab

        const [horaNum, minNum] = hora_cita.split(':').map(Number);
        const minutosDelDia = horaNum * 60 + minNum;

        let diaHabilitado = false;
        let bloqueValido = false;
        let rangosDiaHabilitado: string[] = [];

        for (const bloque of horariosArray) {
            const inicioDia = parseInt(bloque.num_dia_semana_inicio ?? bloque.dia_inicio ?? 1, 10);
            const finDia = parseInt(bloque.num_dia_semana_fin ?? bloque.dia_fin ?? 5, 10);

            let dentroDelDia = false;
            // Manejo de rangos que pueden cruzar la semana (ej. 6 = Sab a 1 = Lun)
            if (inicioDia <= finDia) {
                if (diaSemana >= inicioDia && diaSemana <= finDia) dentroDelDia = true;
            } else {
                if (diaSemana >= inicioDia || diaSemana <= finDia) dentroDelDia = true;
            }

            if (dentroDelDia) {
                diaHabilitado = true;
                const hInicioStr = bloque.hora_inicio;
                const hFinStr = bloque.hora_fin;

                if (!hInicioStr || !hFinStr) {
                    continue;
                }

                const [hI, mI] = hInicioStr.split(':').map(Number);
                const [hF, mF] = hFinStr.split(':').map(Number);

                const minInicio = hI * 60 + (mI || 0);
                const minFin = hF * 60 + (mF || 0);

                rangosDiaHabilitado.push(`${hInicioStr.substring(0, 5)} a ${hFinStr.substring(0, 5)}`);

                if (minutosDelDia >= minInicio && minutosDelDia < minFin) {
                    bloqueValido = true;
                    break;
                }
            }
        }

        if (!diaHabilitado) {
            return {
                valid: false,
                mensaje: `Lo siento, el horario seleccionado no corresponde a nuestros días de atención para este proyecto. ¿Podrías elegir otro día?`
            };
        }

        if (!bloqueValido) {
            const rangosTexto = rangosDiaHabilitado.join(' o de ');
            return {
                valid: false,
                mensaje: `El horario de atención para ese día es de ${rangosTexto}. La hora ${hora_cita} está fuera de horario. ¿Podrías elegir otro horario en ese rango?`
            };
        }

        return { valid: true };
    }

    async agendarCita(params: any, codigoEmpresa: number, leadUuid: string) {
        this.logger.log(`Intentando agendar cita: ${JSON.stringify(params)}`);

        const { fecha_cita, hora_cita, nombre_proyecto, tipo_cita, email, unidad_interes, dormitorios, precio_referencial } = params;

        // Validar y normalizar tipo de cita (PRESENCIAL por defecto)
        const tipoCitaNormalizado = tipo_cita?.toUpperCase() === 'VIRTUAL' ? 'VIRTUAL' : 'PRESENCIAL';

        // Buscar proyecto en BD para obtener ID, ubicación y HORARIO DE ATENCION antes de validar
        let direccion = '';
        let mapaUrl = '';
        let proyectoFinal: Proyecto | undefined;
        let horarioAtencion = undefined;

        try {
            // PRIMERO intentar con el proyecto de la sesión (asegura obtener los horarios correctos del lead)
            if (leadUuid && codigoEmpresa) {
                const sesion = await this.sesionRepo.findOne({ where: { leadUuid, codigoEmpresa } });
                if (sesion && sesion.proyectoId) {
                    proyectoFinal = await this.proyectosRepo.findOne({ where: { id: sesion.proyectoId } }) || undefined;
                }
            }

            // Si no hay proyecto en sesión, intentar buscar por nombre
            if (!proyectoFinal) {
                proyectoFinal = await this.proyectosRepo.findOne({
                    where: { nombre: ILike(`%${nombre_proyecto}%`), codigoEmpresa }
                }) || undefined;
            }

            if (!proyectoFinal) {
                const palabras = nombre_proyecto.split(' ').filter((p: string) => p.length > 3);
                if (palabras.length > 0) {
                    proyectoFinal = await this.proyectosRepo.findOne({
                        where: palabras.map((p: string) => ({ nombre: ILike(`%${p}%`), codigoEmpresa }))
                    }) || undefined;
                }
            }

            this.logger.log(`[AgendarCita] Proyecto buscado: "${nombre_proyecto}" -> Encontrado: ${proyectoFinal?.nombre || 'NO'}`);

            if (proyectoFinal && proyectoFinal.jsonData) {
                horarioAtencion = proyectoFinal.jsonData['horario_atencion'];
            }
        } catch (e) {
            this.logger.error(`Error buscando proyecto para horario: ${e.message}`);
        }

        // === VALIDACIONES DE FECHA Y HORA ===
        const validacion = this.validarFechaHoraCita(fecha_cita, hora_cita, horarioAtencion);
        if (!validacion.valid) {
            return { success: false, mensaje: validacion.mensaje };
        }

        // Actualizar email si lo proporciona
        if (email && leadUuid && codigoEmpresa) {
            await this.actualizarLeadSeguro(leadUuid, codigoEmpresa, { email });
        }

        // Validar si ya tiene una cita ACTIVA FUTURA
        const ultimaCita = await this.citasService.obtenerUltimaCitaPorLead(leadUuid, codigoEmpresa);

        if (ultimaCita) {
            const fechaCitaExistente = new Date(`${ultimaCita.fechaCita}T${ultimaCita.horaCita}`);
            const ahora = new Date();
            const citaEsFutura = fechaCitaExistente > ahora;
            const citaEsActiva = ultimaCita.estadoCita === 'pendiente' || ultimaCita.estadoCita === 'confirmada';

            if (citaEsActiva && citaEsFutura) {
                return {
                    success: false,
                    mensaje: `Ya tienes una cita programada para el ${ultimaCita.fechaCita} a las ${ultimaCita.horaCita}. Si deseas reagendarla, dime la nueva fecha y hora.`
                };
            }
        }

        // Validar disponibilidad del horario (excluyendo al mismo lead)
        const ocupado = await this.citasService.existeCitaEnHorario(fecha_cita, hora_cita, codigoEmpresa, leadUuid);

        if (ocupado) {
            return {
                success: false,
                mensaje: `Lo siento, el horario de las ${hora_cita} para el día ${fecha_cita} ya está ocupado. ¿Podrías elegir otro horario?`
            };
        }

        // Construir observación detallada
        let observacion = `Proyecto interés: ${nombre_proyecto} | Tipo: ${tipoCitaNormalizado}`;
        if (unidad_interes) observacion += ` | Unidad: ${unidad_interes}`;
        if (dormitorios) observacion += ` | Dorms: ${dormitorios}`;
        if (precio_referencial) observacion += ` | Precio: S/${precio_referencial}`;

        // Obtener detalles de ubicacion y URL
        try {
            if (proyectoFinal) {
                let foundInJson = false;
                if (proyectoFinal.jsonData && proyectoFinal.jsonData['direccion_sala_ventas']) {
                    direccion = proyectoFinal.jsonData['direccion_sala_ventas'];
                    foundInJson = true;
                }

                if (!foundInJson && proyectoFinal.ubicacion) {
                    const ubicacionRaw = proyectoFinal.ubicacion;
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    const match = ubicacionRaw.match(urlRegex);

                    if (match) {
                        mapaUrl = match[0];
                        let cleanAddr = ubicacionRaw.replace(urlRegex, '').replace(/Google Maps:?/i, '').trim();
                        cleanAddr = cleanAddr.replace(/^[:\-\s]+|[:\-\s]+$/g, '');

                        if (cleanAddr.length > 3) {
                            direccion = cleanAddr;
                        }
                    } else {
                        direccion = ubicacionRaw;
                        const encodedAddress = encodeURIComponent(direccion);
                        mapaUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
                    }
                }
            }
        } catch (e) {
            this.logger.error(`Error buscando proyecto para ubicacion: ${e.message}`);
        }

        // Crear Cita con proyecto
        const citaCreada = await this.citasService.crearCita({
            codigoEmpresa,
            leadUuid: leadUuid,
            fechaCita: fecha_cita,
            horaCita: hora_cita,
            tipoCita: tipoCitaNormalizado,
            observacion: observacion,
            estadoCita: 'pendiente',
            proyectoId: proyectoFinal?.id || null,
            nombreProyecto: proyectoFinal?.nombre || nombre_proyecto,
        });

        try {
            await this.servicioSperant.sincronizarCitaDesdeAgendaLocal({
                idCitaLocal: citaCreada.id,
                codigoEmpresa,
                leadUuid,
                place: direccion || mapaUrl || proyectoFinal?.nombre || nombre_proyecto,
            });
            this.logger.log(`[AgendarCita] Cita ${citaCreada.id} sincronizada con SPERANT`);
        } catch (error) {
            this.logger.error(`[AgendarCita] No se pudo sincronizar la cita ${citaCreada.id} con SPERANT: ${error.message}`);
        }

        // Actualizar Estado Sesion y Clasificacion
        try {
            const sesion = await this.sesionRepo.findOne({ where: { leadUuid, codigoEmpresa } });
            if (sesion) {
                sesion.idEstado = 2;
                await this.sesionRepo.save(sesion);

                const historial = this.clasificacionRepo.create({
                    idSesion: sesion.id,
                    clasificacion: 'alto',
                    razon: 'Agendó cita satisfactoriamente',
                });
                await this.clasificacionRepo.save(historial);
                this.logger.log(`[AgendarCita] Lead clasificado como ALTO y Sesion actualizada a estado 2`);
            }
        } catch (err) {
            this.logger.error(`[AgendarCita] Error actualizando clasificacion: ${err.message}`);
        }


        const tipoTexto = tipoCitaNormalizado === 'VIRTUAL' ? 'videollamada virtual' : 'visita presencial';
        const nombreProyectoFinal = proyectoFinal?.nombre || nombre_proyecto;

        let outputMsg = `[ACCION_COMPLETADA] Cita ${tipoTexto} AGENDADA EXITOSAMENTE.
        
DATOS DE LA CITA:
- 📅 Fecha: ${fecha_cita}
- 🕐 Hora: ${hora_cita}
- 👥 Tipo: ${tipoCitaNormalizado}
- 🏢 Proyecto: ${nombreProyectoFinal}`;

        if (direccion) {
            outputMsg += `\n- 📍 Dirección: ${direccion}`;
        }
        if (mapaUrl) {
            outputMsg += `\n- Link Mapa: ${mapaUrl}`;
        }

        outputMsg += `\n\nTe esperamos para que conozcas el departamento y resolvamos cualquier duda en persona.`;

        if (!direccion && !mapaUrl) {
            outputMsg += ` Te enviaré la ubicación exacta más adelante.`;
        }

        outputMsg += `\n\n<<INSTRUCCION_IA: NO menciones confirmacion por correo electronico. NO digas que enviaste confirmacion al email. Solo confirma la cita con los datos proporcionados arriba (fecha, hora, direccion, mapa). El email se usa internamente, NO se envia confirmacion por email al cliente.>>`;

        return {
            success: true,
            mensaje: outputMsg
        };
    }

    /**
     * Reagenda una cita existente - Solo actualiza lo que el cliente quiere cambiar
     */
    async reagendarCita(params: any, codigoEmpresa: number, leadUuid: string) {
        this.logger.log(`[ReagendarCita] Params: ${JSON.stringify(params)}`);

        const { tipo_cita_nuevo, fecha_nueva, hora_nueva, motivo_cambio } = params;

        // 1. VALIDACIÓN CRÍTICA: Obtener cita actual
        const citaActual = await this.citasService.obtenerUltimaCitaPorLead(leadUuid, codigoEmpresa);

        if (!citaActual) {
            this.logger.error(`[ReagendarCita] ERROR: No existe cita previa para lead ${leadUuid}`);
            return {
                success: false,
                mensaje: "ERROR INTERNO: No puedes reagendar porque NO TIENES ninguna cita agendada. Esta herramienta solo se usa cuando YA existe una cita."
            };
        }

        // 2. Validar estado de la cita
        if (citaActual.estadoCita === 'cancelada' || citaActual.estadoCita === 'realizada') {
            this.logger.warn(`[ReagendarCita] Cita ya está ${citaActual.estadoCita}`);
            return {
                success: false,
                mensaje: `Tu cita anterior está ${citaActual.estadoCita}. Si quieres, puedo agendar una nueva.`
            };
        }

        this.logger.log(`[ReagendarCita] Cita actual encontrada: ${citaActual.fechaCita} ${citaActual.horaCita}`);

        // 3. Preparar datos a actualizar (solo lo que cambió)
        const datosActualizacion: any = {};
        const cambios: string[] = [];

        // Tipo de cita
        if (tipo_cita_nuevo) {
            const tipoNormalizado = tipo_cita_nuevo.toUpperCase();
            if (citaActual.tipoCita !== tipoNormalizado) {
                datosActualizacion.tipoCita = tipoNormalizado;
                cambios.push(`tipo de ${citaActual.tipoCita} a ${tipoNormalizado}`);
            }
        }

        // Validar nuevas fechas si se proporcionan
        if (fecha_nueva || hora_nueva) {
            const fEvaluar = fecha_nueva || citaActual.fechaCita;
            const hEvaluar = hora_nueva || citaActual.horaCita;

            // Extraer el horario dynamico del proyecto actual de la cita
            let horarioAtencion = undefined;
            if (citaActual.proyectoId) {
                try {
                    const proyectoDb = await this.proyectosRepo.findOne({ where: { id: citaActual.proyectoId } });
                    if (proyectoDb && proyectoDb.jsonData) {
                        horarioAtencion = proyectoDb.jsonData['horario_atencion'];
                    }
                } catch (e) {
                    this.logger.warn(`Error buscando horario en reagendarCita: ${e.message}`);
                }
            }

            const validacion = this.validarFechaHoraCita(fEvaluar, hEvaluar, horarioAtencion);
            if (!validacion.valid) {
                return { success: false, mensaje: validacion.mensaje };
            }

            // Check collisions
            const ocupado = await this.citasService.existeCitaEnHorario(fEvaluar, hEvaluar, codigoEmpresa, citaActual.id.toString());
            if (ocupado) {
                return {
                    success: false,
                    mensaje: `Lo siento, el horario de las ${hEvaluar} para el día ${fEvaluar} ya está ocupado.`
                };
            }

            if (fecha_nueva && fecha_nueva !== citaActual.fechaCita) {
                datosActualizacion.fechaCita = fecha_nueva;
                cambios.push(`fecha a ${fecha_nueva}`);
            }
            if (hora_nueva && hora_nueva !== citaActual.horaCita) {
                datosActualizacion.horaCita = hora_nueva;
                cambios.push(`hora a ${hora_nueva}`);
            }
        }

        if (motivo_cambio) {
            const obsBase = citaActual.observacion?.split(' | Reagendada:')[0] || citaActual.observacion || '';
            datosActualizacion.observacion = `${obsBase} | Reagendada: ${motivo_cambio}`.trim();
        }

        // Si no hay cambios reales, no hacer nada
        if (Object.keys(datosActualizacion).length === 0) {
            this.logger.log(`[ReagendarCita] No hay cambios que realizar`);
            return {
                success: true,
                mensaje: `Tu cita ya está programada para el ${citaActual.fechaCita} a las ${citaActual.horaCita}. No hay cambios que realizar.`
            };
        }

        this.logger.log(`[ReagendarCita] Actualizando cita ID ${citaActual.id} con: ${JSON.stringify(datosActualizacion)}`);
        await this.citasService.reagendarCita(citaActual.id, datosActualizacion);

        const fFinal = datosActualizacion.fechaCita || citaActual.fechaCita;
        const hFinal = datosActualizacion.horaCita || citaActual.horaCita;
        const tipoFinal = datosActualizacion.tipoCita || citaActual.tipoCita;
        const tipoTexto = tipoFinal === 'VIRTUAL' ? 'virtual' : 'presencial';

        return {
            success: true,
            mensaje: `[ACCION_COMPLETADA] Listo, actualicé tu cita ${cambios.length > 0 ? `(${cambios.join(', ')})` : ''}. Ahora es ${tipoTexto} para el ${fFinal} a las ${hFinal}.`
        };
    }


    /**
     * Gestión de Preguntas Frecuentes (FAQs) y Datos Generales del Proyecto
     * Busca en la colección de documentos/FAQs (NO en inventario de departamentos)
     */
    async buscarPreguntasFrecuentes(params: any, proyectoId?: number) {
        try {
            const { queries_de_busqueda, nombre_proyecto, codigoEmpresa, proyectoIdSesion, leadUuid } = params;
            const proyectoSesion = proyectoIdSesion || proyectoId || null;
            this.logger.log(`Buscando FAQ: ${queries_de_busqueda.join(', ')} en ${nombre_proyecto || 'proyecto activo'}`);

            const queryPrincipal = queries_de_busqueda?.[0] || '';
            const proyectosActivos = codigoEmpresa
                ? await this.obtenerProyectosActivosOrdenados(codigoEmpresa)
                : [];
            const textoNormalizado = normalizeToolText(
                [nombre_proyecto, ...(queries_de_busqueda || [])].filter(Boolean).join(' ')
            );
            const proyectosMencionados = resolveMentionedProjects(
                textoNormalizado,
                proyectosActivos,
                nombre_proyecto
            );
            const explicitMultiProject = isFaqMultiProjectQuery(textoNormalizado, proyectosActivos.length) || proyectosMencionados.length > 1;

            let modoBusqueda: 'active_only' | 'project_only' | 'multi_project' = 'active_only';
            if (explicitMultiProject) {
                modoBusqueda = 'multi_project';
            } else if ((nombre_proyecto && nombre_proyecto.trim()) || proyectosMencionados.length === 1) {
                modoBusqueda = 'project_only';
            }

            let proyectosObjetivo: Proyecto[] = [];

            if (modoBusqueda === 'active_only') {
                if (proyectoSesion) {
                    const proyectoActual = proyectosActivos.find(p => p.id === proyectoSesion);
                    if (proyectoActual) {
                        proyectosObjetivo = [proyectoActual];
                    } else if (codigoEmpresa) {
                        const proyectoDb = await this.proyectosRepo.findOne({
                            where: { id: proyectoSesion, codigoEmpresa, estado: 'activo' }
                        });
                        if (proyectoDb) {
                            proyectosObjetivo = [proyectoDb];
                        }
                    }
                } else if (proyectosActivos.length === 1) {
                    proyectosObjetivo = [proyectosActivos[0]];
                }
            } else if (modoBusqueda === 'project_only') {
                proyectosObjetivo = proyectosMencionados.slice(0, 1);

                if (proyectosObjetivo.length === 0 && nombre_proyecto?.trim() && codigoEmpresa) {
                    const resolvedId = await this.obtenerIdProyectoPorNombre(nombre_proyecto, codigoEmpresa);
                    if (resolvedId) {
                        const proyectoDb = proyectosActivos.find(p => p.id === resolvedId)
                            || await this.proyectosRepo.findOne({
                                where: { id: resolvedId, codigoEmpresa, estado: 'activo' }
                            });
                        if (proyectoDb) {
                            proyectosObjetivo = [proyectoDb];
                        }
                    }
                }
            } else {
                const pideOtros = /\botros?\s+proyectos?\b/i.test(textoNormalizado) || /\bdemas\s+proyectos?\b/i.test(textoNormalizado);

                if (proyectosMencionados.length > 0) {
                    proyectosObjetivo = proyectosMencionados;
                } else if (pideOtros && proyectoSesion) {
                    proyectosObjetivo = proyectosActivos.filter(p => p.id !== proyectoSesion);
                } else {
                    proyectosObjetivo = proyectosActivos;
                }
            }

            if (proyectosObjetivo.length === 0) {
                if (modoBusqueda === 'project_only') {
                    const referenciaProyecto = nombre_proyecto?.trim() || 'ese proyecto';
                    return `[INFO_FALTANTE] No encontre un proyecto activo que coincida con "${referenciaProyecto}". <<INSTRUCCION_IA: Pídele al cliente que confirme el nombre exacto o el numero del proyecto, sin cambiar el proyecto actual.>>`;
                }

                if (modoBusqueda === 'multi_project') {
                    return "[ACCION_COMPLETADA] No encontre otros proyectos activos con informacion FAQ disponible para responder esa consulta. <<INSTRUCCION_IA: Explícalo de forma natural y mantén el proyecto actual del cliente sin cambios.>>";
                }
            }

            if (proyectosObjetivo.length === 0) {
                throw new Error('PROYECTO_NO_SELECCIONADO');
            }

            this.logger.log(
                `[FAQ] modo=${modoBusqueda}, proyectoSesion=${proyectoSesion ?? 'none'}, objetivo=${proyectosObjetivo.map(p => `${p.id}:${p.nombre}`).join(', ')}`
            );

            const resultadosFaq = await this.buscarDocumentosFaq(
                queryPrincipal,
                proyectosObjetivo,
                modoBusqueda === 'multi_project' ? 3 : 4
            );
            const docs = resultadosFaq.slice(0, modoBusqueda === 'multi_project' ? 8 : 5);
            const contexto = buildFaqContext(docs);

            this.logger.log(`FAQ RAG - Docs encontrados: ${docs.length}`);
            this.logger.debug(`Contexto FAQ: ${contexto}`);

            if (!contexto.trim()) {
                return "[ACCION_COMPLETADA] No encontre informacion especifica sobre esa consulta en mis registros. <<INSTRUCCION_IA: No inventes ni sigas insistiendo con la misma pregunta. Si esta duda bloquea la decision del cliente o el cliente insiste, activa modo contencion y ofrece agendar una visita para que lo atienda un asesor.>>";
            }

            const proyectoPrincipal = proyectosObjetivo[0];
            const proyectoSesionActual = proyectosActivos.find(p => p.id === proyectoSesion) || null;

            let instruccionNoCambio = '<<INSTRUCCION_IA: Mantén el proyecto actual del cliente tal como está.>>';

            if (modoBusqueda !== 'active_only') {
                instruccionNoCambio = `<<INSTRUCCION_IA: La respuesta se obtuvo usando FAQs de ${modoBusqueda === 'multi_project' ? 'varios proyectos' : `\"${proyectoPrincipal?.nombre || 'otro proyecto'}\"`} sin cambiar el proyecto actual del cliente. NO ejecutes guardar_proyecto a menos que el cliente confirme explícitamente que quiere cambiarse.>>`;
            }

            let instruccionCambioProyecto = '';
            if (
                modoBusqueda === 'project_only' &&
                proyectoPrincipal &&
                proyectoSesionActual &&
                proyectoPrincipal.id !== proyectoSesionActual.id
            ) {
                instruccionCambioProyecto = ` <<INSTRUCCION_IA: Después de responder, pregúntale explícitamente: "Tu proyecto actual es ${proyectoSesionActual.nombre}. ¿Te gustaría cambiarte a ${proyectoPrincipal.nombre}?" Si el cliente confirma con un sí claro, recién ejecuta guardar_proyecto y desde ese momento continúa todo el flujo usando ${proyectoPrincipal.nombre}.>>`;
            }

            const instruccionPrecisionRespuesta = ' <<INSTRUCCION_IA: Responde usando solo los datos literales recuperados arriba. Si el cliente pregunta por varios proyectos o por varios datos y alguno no aparece de forma explicita en esta respuesta, di que no lo tienes confirmado. NO inventes, completes ni deduzcas informacion faltante.>>';

            const respuestaDeterministica = this.getFaqDirectResponse(docs, modoBusqueda);
            if (respuestaDeterministica) {
                return `[ACCION_COMPLETADA] ${respuestaDeterministica} ${instruccionNoCambio}${instruccionCambioProyecto}${instruccionPrecisionRespuesta}`;
            }

            const promptTemplate = ChatPromptTemplate.fromTemplate(`
Eres el asistente inmobiliario de Checor. Responde la pregunta del usuario usando EXCLUSIVAMENTE la informacion del contexto.

MODO DE BUSQUEDA: {search_mode}
PROYECTO ACTIVO DE LA SESION: {session_project_name}
PROYECTOS CONSULTADOS: {searched_projects}

CONTEXTO (informacion oficial recuperada):
{context}

PREGUNTA DEL USUARIO: {question}

REGLAS:
- USA la informacion del contexto para responder. Si alguna pregunta frecuente trata un tema similar o relacionado a lo que pregunta el usuario, USA esa respuesta.
- Por ejemplo: si el usuario pregunta "direccion" y el contexto tiene info sobre "ubicacion", SON LO MISMO, responde con esa info.
- Si el contexto dice "No contamos con...", responde "No contamos con...".
- Responde de forma natural, NO menciones "segun la base de datos" ni "segun el contexto".
- Si el contexto trae una fecha exacta o estimada de entrega, responde con esa fecha exacta. NO la transformes en "entrega inmediata", "listo para entrega" o frases equivalentes salvo que el contexto lo diga literalmente.
- Si el contexto contiene informacion de varios proyectos, menciona claramente el nombre del proyecto al que pertenece cada dato relevante.
- Si la pregunta es de ubicacion, direccion o mapa y el contexto NO trae una direccion o link literal para alguno de los proyectos preguntados, di que no tienes la ubicacion confirmada de ese proyecto. NO completes listas de proyectos con direcciones inventadas.
- Si la pregunta es sobre otro proyecto distinto al activo, responde con ese proyecto sin decir que cambiaste la sesion ni insinuar que ya se actualizo el proyecto.
- SOLO di "No tengo informacion sobre eso" si NINGUNA de las preguntas frecuentes del contexto tiene relacion alguna con lo que pregunta el usuario.

RESPUESTA:`);

            const faqPromptMessages = await promptTemplate.formatMessages({
                context: contexto,
                question: queryPrincipal,
                search_mode: modoBusqueda,
                session_project_name: proyectosActivos.find(p => p.id === proyectoSesion)?.nombre || 'sin proyecto activo',
                searched_projects: proyectosObjetivo.map(p => p.nombre).join(', '),
            });
            const faqResponse = await this.llm.invoke(faqPromptMessages);
            await this.registrarTokensFaq(leadUuid, codigoEmpresa, faqResponse, {
                modoBusqueda,
                proyectoSesion,
                proyectosObjetivo: proyectosObjetivo.map((proyecto) => proyecto.id),
            });
            const resultado = faqResponse.content?.toString().trim() || '';

            this.logger.debug(`Respuesta LLM FAQ: ${resultado}`);

            if (!resultado || resultado.toLowerCase().includes("no encontré") || resultado.toLowerCase().includes("no tengo información")) {
                return "[ACCION_COMPLETADA] No encontre informacion sobre eso en mis registros. <<INSTRUCCION_IA: No inventes ni reformules la misma consulta en bucle. Si esta duda es importante para que el cliente decida o ya hubo friccion, activa modo contencion y ofrece agendar una visita para que lo atienda un asesor.>>";
            }

            return `[ACCION_COMPLETADA] ${resultado} ${instruccionNoCambio}${instruccionCambioProyecto}${instruccionPrecisionRespuesta}`;

        } catch (error) {
            if (error.message === 'PROYECTO_NO_SELECCIONADO') {
                return "[INFO_FALTANTE] No tengo un proyecto seleccionado en este momento. <<INSTRUCCION_IA: Pregúntale al cliente sobre qué proyecto en específico tiene esta duda.>>";
            }
            this.logger.error(`Error en buscarPreguntasFrecuentes: ${error.message}`);
            return "[ACCION_COMPLETADA] Hubo un problema al consultar esa informacion. <<INSTRUCCION_IA: No sigas insistiendo ni prometas el dato. Activa modo contencion y ofrece agendar una visita para que lo atienda un asesor.>>";
        }
    }

    async validarDni(params: { dni: string; leadUuid?: string; codigoEmpresa?: number }) {
        const dni = (params.dni || '').trim();
        const { leadUuid, codigoEmpresa } = params;

        // Validaciones
        if (!dni || dni.length !== 8) {
            return { success: false, mensaje: "El DNI debe tener exactamente 8 dígitos." };
        }

        if (!/^\d{8}$/.test(dni)) {
            return { success: false, mensaje: "El DNI solo debe contener números." };
        }

        if (!this.isValidDni(dni)) {
            return { success: false, mensaje: "DNI invalido. Por favor verifica el numero." };
        }

        //  Actualizar lead en BD si tenemos contexto (solo si está vacío)
        if (leadUuid && codigoEmpresa) {
            await this.actualizarLeadSeguro(leadUuid, codigoEmpresa, { dni });
        }

        return { success: true, mensaje: "[ACCION_COMPLETADA] DNI validado correctamente. <<INSTRUCCION_IA: Continua con el siguiente paso del flujo.>>" };
    }

    async buscarPorCuota(params: { cuota_mensual: number; proyectoId?: number }) {
        try {
            this.logger.log(`Buscando por cuota mensual: S/${params.cuota_mensual}`);

            // Calcular precio máximo aproximado usando la fórmula inversa
            // cuota_mensual ≈ precio_total / 200 (aproximación)
            const precioMaxAprox = params.cuota_mensual * 200;

            this.logger.log(`Precio máximo estimado: S/${precioMaxAprox}`);

            const collectionName = await this.obtenerColeccionInventario(params.proyectoId);

            const queryText = `departamentos disponibles precio hasta ${precioMaxAprox} soles`;

            const filters: any = {
                precioMax: precioMaxAprox,
                disponible: true
            };

            const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                queryText,
                filters,
                { limit: 5, threshold: 0.5 }
            );

            this.logger.log(`Resultados por cuota: ${resultados.length} departamentos`);

            if (resultados.length === 0) {
                return JSON.stringify({
                    success: false,
                    mensaje: `No encontré departamentos que se ajusten a una cuota de S/${params.cuota_mensual}. ¿Podrías aumentar tu presupuesto o considerar otra opción?`
                });
            }

            // Formatear resultados con cálculo de cuota aproximada
            const datos = resultados.map((r: any) => {
                const m = r.metadata;
                const fechaLimite = new Date('2025-01-01');
                const mostrarPromos = new Date() < fechaLimite;

                const pListNum = parseFloat(m.price_list?.replace(/[^0-9.]/g, '') || '0');
                const pPromoNum = parseFloat(m.price_promo?.replace(/[^0-9.]/g, '') || '0');

                // Si NO mostramos promos, usamos pListNum como base
                let precioBase = pListNum;
                if (mostrarPromos && pPromoNum > 0) {
                    precioBase = pPromoNum;
                } else if (!mostrarPromos) {
                    precioBase = pListNum;
                } else {
                    precioBase = pPromoNum || pListNum;
                }

                const cuotaAprox = Math.round(precioBase / 200); // Aproximación simple

                return {
                    unidad: m.unit_number,
                    dormitorios: m.bedrooms,
                    area: m.area_total,
                    piso: m.floor,
                    precio_lista: m.price_list,
                    precio_promo: mostrarPromos ? m.price_promo : null,
                    cuota_aprox: cuotaAprox,
                    disponibilidad: m.availability,
                    vista: m.view
                };
            });

            return JSON.stringify({
                success: true,
                cuota_solicitada: params.cuota_mensual,
                datos: datos,
                nota: "Las cuotas son aproximadas. Para una cotización exacta, necesitamos más detalles."
            });

        } catch (error) {
            if (error.message === 'PROYECTO_NO_SELECCIONADO') {
                return JSON.stringify({
                    success: false,
                    mensaje: "[INFO_FALTANTE] No tengo un proyecto seleccionado en este momento. <<INSTRUCCION_IA: Pregúntale al cliente en qué proyecto específico está buscando el departamento.>>"
                });
            }
            this.logger.error(`Error buscando por cuota: ${error.message}`);
            return JSON.stringify({
                success: false,
                mensaje: "Hubo un error al buscar departamentos por cuota. Por favor intenta de nuevo."
            });
        }
    }

    async mostrarDepartamentos(params: { dormitorios?: number, piso?: number, proyectoId?: number }) {
        try {
            this.logger.log(`Buscando departamentos - Dormitorios: ${params.dormitorios}, Piso: ${params.piso}`);

            const collectionName = await this.obtenerColeccionInventario(params.proyectoId);

            let queryText = 'departamento disponible';
            if (params.dormitorios) {
                queryText += ` ${params.dormitorios} dormitorios`;
            }
            if (params.piso) {
                queryText += ` piso ${params.piso}`;
            }

            const filters: any = {};
            if (params.dormitorios !== undefined) {
                filters.dormitorios = params.dormitorios;
            }
            if (params.piso !== undefined) {
                filters.pisoMin = params.piso;
                filters.pisoMax = params.piso;
            }

            const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                queryText,
                filters,
                { limit: 10, threshold: 0.5 }
            );

            this.logger.log(`Resultados encontrados: ${resultados.length} departamentos`);

            if (resultados.length === 0) {
                this.logger.warn(`No se encontraron resultados para dormitorios: ${params.dormitorios}`);
                return "[ACCION_COMPLETADA] No encontre departamentos disponibles con esas caracteristicas. <<INSTRUCCION_IA: Pregunta si quiere ver otras opciones.>>";
            }
            // Mostrar lista de resultados
            const lista = resultados.map((r, idx) => {
                const m = r.document.metadata;

                // Formatear precios
                const pList = m.price_list ? parseFloat(m.price_list) : 0;
                const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;

                // Validacion temporal: Ocultar promos si la fecha actual > 2025
                const fechaLimite = new Date('2025-01-01');
                const mostrarPromos = new Date() < fechaLimite;

                let precioMostrar = '';
                if (mostrarPromos && pPromo && pPromo < pList) {
                    precioMostrar = `S/${pList.toLocaleString('es-PE')} -> **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
                } else {
                    precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
                }

                const dormitoriosText = m.bedrooms === 0 ? 'Monoambiente' : `${m.bedrooms} dormitorio${m.bedrooms > 1 ? 's' : ''}`;

                return `${idx + 1}. Unidad ${m.unit_number} - ${dormitoriosText}, ${m.area_total}m² - Precio: ${precioMostrar}`;
            }).join('\n');

            const respuesta = `[ACCION_COMPLETADA] Hay ${resultados.length} departamento${resultados.length > 1 ? 's' : ''} disponible${resultados.length > 1 ? 's' : ''}:\n\n${lista}\n\n<<INSTRUCCION_IA: Pregunta si quiere agendar visita.>>`;

            return respuesta;

        } catch (error) {
            if (error.message === 'PROYECTO_NO_SELECCIONADO') {
                return "[INFO_FALTANTE] No tengo un proyecto seleccionado en este momento. <<INSTRUCCION_IA: Pregúntale al cliente en qué proyecto específico está buscando el departamento.>>";
            }
            this.logger.error(`>>> ERROR en mostrarDepartamentos: ${error.message}`, error.stack);
            return "Ocurrio un error al buscar departamentos. Por favor intenta nuevamente en un momento.";
        }
    }

    async generarProforma(params: {
        nombre_cliente?: string;
        dni?: string;
        ocupacion?: string;
        ingresos?: string;
        unidad?: string;
        precio?: string;
        dormitorios?: number;
        area?: string;
        piso?: number;
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            this.logger.log(`Generando proforma para: ${params.nombre_cliente}`);

            const ocupacionCorregida = await this.corregirOcupacion(params.ocupacion);
            const ingresosFormateados = formatMonto(params.ingresos);
            const precioFormateado = formatMonto(params.precio);

            if (params.leadUuid && params.codigoEmpresa && params.nombre_cliente) {
                const nombreCompleto = params.nombre_cliente.trim();
                const partes = nombreCompleto.split(' ');

                const datos: any = {};
                if (partes.length >= 2) {
                    datos.nombre = partes[0];
                    datos.apellido = partes.slice(1).join(' ');
                } else {
                    datos.nombre = nombreCompleto;
                }

                await this.actualizarLeadSeguro(params.leadUuid, params.codigoEmpresa, datos);
            }

            // Capturar datos del cliente en el resumen (con ocupación corregida)
            if (params.leadUuid && params.codigoEmpresa) {
                const puntos: string[] = [];
                if (ocupacionCorregida) puntos.push(`Paso 9 - Ocupación: ${ocupacionCorregida}`);
                if (params.ingresos) puntos.push(`Paso 9 - Ingresos mensuales: ${ingresosFormateados}`);
                if (params.unidad && params.precio) {
                    puntos.push(`Paso 6 - Unidad de interes: ${params.unidad}`);
                    puntos.push(`Paso 9 - Proforma generada para unidad ${params.unidad} (${params.dormitorios || '?'} dorms, ${precioFormateado})`);
                }

                if (puntos.length > 0) {
                    await this.resumenService.agregarPuntos(params.leadUuid, params.codigoEmpresa, puntos);
                }
            }

            // Construir resumen formateado (sin emojis)
            const resumen = `RESUMEN DE TU COTIZACION\n\n` +
                `DATOS DEL CLIENTE:\n` +
                `. Nombre: ${params.nombre_cliente || 'N/A'}\n` +
                `. DNI: ${params.dni || 'N/A'}\n` +
                `. Ocupación: ${ocupacionCorregida || 'N/A'}\n` +
                `. Ingresos: ${ingresosFormateados}\n\n` +
                `DETALLES DEL DEPARTAMENTO:\n` +
                `. Unidad: ${params.unidad || 'N/A'}\n` +
                `. Dormitorios: ${params.dormitorios || 'N/A'}\n` +
                `. Área: ${params.area || 'N/A'}\n` +
                `. Piso: ${params.piso || 'N/A'}\n` +
                `. Precio: ${precioFormateado}\n\n`;

            if (params.phoneNumber && params.codigoEmpresa) {
                const response: any = await this.wapiService.sendMessage(params.codigoEmpresa, params.phoneNumber, resumen);
                this.logger.log(`Proforma enviada a ${params.phoneNumber}`);

                let wamid = null;
                let estado = 'enviado';
                let errorDetails = null;

                if (response && response.error) {
                    estado = 'fallido';
                    errorDetails = response.details;
                } else {
                    wamid = response?.messages?.[0]?.id || response?.id || null;
                }

                // Guardar en Inbox si hay UUID
                if (params.leadUuid) {
                    await this.inboxService.guardarMensajeBot({
                        leadUuid: params.leadUuid,
                        codigoEmpresa: params.codigoEmpresa,
                        contenido: resumen,
                        wamid: wamid,
                        estadoMensaje: estado,
                        errorWapi: errorDetails
                    });
                }
            }

            return `[ACCION_COMPLETADA] Proforma generada y enviada al cliente por WhatsApp. <<INSTRUCCION_IA: Dile que ya se la enviaste y ofrece coordinar la visita preguntando dia y hora. NO ofrezcas recorrido virtual ni videos salvo que el cliente lo pida.>>`;

        } catch (error) {
            this.logger.error(`Error generando proforma: ${error.message}`);
            return "Hubo un problema al generar la proforma. Por favor intenta de nuevo.";
        }
    }


    /**
     * HERRAMIENTA UNIVERSAL MEJORADA: Busca departamentos con estrategia de FALLBACK (rebote)
     * Si no encuentra exacto, relaja filtros progresivamente para siempre dar opciones.
     */
    async buscarDepartamentoUniversal(params: {
        unidad?: string;
        dormitorios?: number | string | (number | string)[];
        piso?: number;
        precio_max?: number;
        precio_min?: number;
        vista?: string;
        tipologia?: string;
        tipo_unidad?: string;
        area_min?: number;
        preferencia_piso?: 'bajos' | 'altos';
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
        proyectoId?: number;
        nombre_proyecto?: string;
    }) {
        try {
            let actualProyectoId = params.proyectoId;

            if (params.nombre_proyecto && params.codigoEmpresa) {
                const resolvedId = await this.obtenerIdProyectoPorNombre(params.nombre_proyecto, params.codigoEmpresa);
                if (resolvedId) {
                    actualProyectoId = resolvedId;
                }
            }

            if (
                actualProyectoId &&
                params.codigoEmpresa &&
                params.leadUuid &&
                actualProyectoId !== params.proyectoId
            ) {
                await this.sincronizarProyectoSesionPorId(
                    actualProyectoId,
                    params.codigoEmpresa,
                    params.leadUuid,
                    'buscar_departamento'
                );
            }

            const collectionName = await this.obtenerColeccionInventario(actualProyectoId);
            const logPrefix = `[BusquedaUniversal]`;

            this.logger.log(`${logPrefix} Params: ${JSON.stringify(params)}`);

            // Capturar preferencias del cliente en el resumen
            if (params.leadUuid && params.codigoEmpresa) {
                const puntos: string[] = [];
                const d = params.dormitorios;
                const dormsArray = Array.isArray(d) ? d : [d];
                const dormsStr = dormsArray.map(val => {
                    if (typeof val === 'string' && val.toLowerCase().includes('mono')) return 'Monoambiente';
                    if (val === 0) return 'Monoambiente';
                    return val;
                }).join(' y ');

                if (d) puntos.push(`Busca depa de ${dormsStr} dormitorio(s)`);
                if (params.precio_max) puntos.push(`Presupuesto maximo: S/${params.precio_max.toLocaleString('es-PE')}`);
                if (params.vista) puntos.push(`Prefiere vista ${params.vista}`);
                if (params.piso) puntos.push(`Interesado en piso ${params.piso}`);
                if (params.tipo_unidad) puntos.push(`Busca tipo: ${params.tipo_unidad}`);

                if (puntos.length > 0) {
                    await this.resumenService.agregarPuntos(params.leadUuid, params.codigoEmpresa, puntos);
                }
            }

            // --- CASO 1: BUSQUEDA POR UNIDAD ESPECIFICA (Prioridad Maxima) ---
            if (params.unidad) {
                if (params.leadUuid && params.codigoEmpresa) {
                    await this.resumenService.agregarPunto(
                        params.leadUuid,
                        params.codigoEmpresa,
                        `Interesado en unidad ${params.unidad}`
                    );
                }
                return this.manejarBusquedaPorUnidad(params, collectionName);
            }

            // Normalizar dormitorios: Convertir strings "monoambiente" a 0
            let normalizedDorms: number | number[] | undefined = undefined;

            if (params.dormitorios !== undefined) {
                const processDorm = (val: string | number): number => {
                    if (typeof val === 'string') {
                        const v = val.toLowerCase();
                        if (v.includes('mono') || v.includes('estudio') || v.includes('loft')) return 0;
                        const parsed = parseInt(val);
                        return isNaN(parsed) ? -1 : parsed; // -1 for invalid
                    }
                    return val;
                };

                if (Array.isArray(params.dormitorios)) {
                    normalizedDorms = params.dormitorios.map(processDorm).filter(d => d !== -1);
                } else {
                    const val = processDorm(params.dormitorios);
                    if (val !== -1) normalizedDorms = val;
                }
            }

            // Actualizar params con valores normalizados para uso interno (Qdrant usa numeros)
            const paramsInternal = { ...params, dormitorios: normalizedDorms };


            // --- CASO ESPECIAL: MULTIPLES DORMITORIOS ---
            if (Array.isArray(paramsInternal.dormitorios) && paramsInternal.dormitorios.length > 0) {
                this.logger.log(`${logPrefix} Busqueda multi-dormitorios: ${paramsInternal.dormitorios.join(', ')}`);

                const promesas = paramsInternal.dormitorios.map(d => {
                    const singleParams = { ...paramsInternal, dormitorios: d }; // forzar individual
                    return this.ejecutarBusquedaQdrant(collectionName, singleParams, params.preferencia_piso);
                });

                const resultadosRaw = await Promise.all(promesas);

                // Agrupar resultados por dormitorio para reporte estructurado
                const resultadosPorDormitorio: { [key: number]: any[] } = {};
                const dormitoriosConResultados: number[] = [];
                const dormitoriosSinResultados: number[] = [];

                paramsInternal.dormitorios.forEach((d, idx) => {
                    const res = resultadosRaw[idx];
                    if (res.ok && res.items.length > 0) {
                        resultadosPorDormitorio[d] = res.items;
                        dormitoriosConResultados.push(d);
                    } else {
                        dormitoriosSinResultados.push(d);
                    }
                });

                // Si encontramos resultados (aunque sea de algunos dormitorios)
                if (dormitoriosConResultados.length > 0) {
                    let respuestaCompleta = `[ACCION_COMPLETADA] Aqui estan las opciones disponibles:\n\n`;

                    dormitoriosConResultados.sort((a, b) => a - b).forEach(dorms => {
                        const items = resultadosPorDormitorio[dorms].slice(0, 3); // Top 3 de cada tipo
                        const dormsLabel = dorms === 0 ? 'Monoambiente/Estudio' : `${dorms} dormitorio${dorms > 1 ? 's' : ''}`;
                        respuestaCompleta += `**Opciones tipo ${dormsLabel}:**\n`;

                        items.forEach((r, idx) => {
                            const m = r.document.metadata;
                            const pList = m.price_list ? parseFloat(m.price_list) : 0;
                            const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;
                            // Validacion temporal para no mostrar promos hasta nueva subida de data
                            const fechaLimite = new Date('2025-01-01');
                            const mostrarPromos = new Date() < fechaLimite;

                            let precioMostrar = '';
                            if (mostrarPromos && pPromo && pPromo < pList) {
                                precioMostrar = `S/${pList.toLocaleString('es-PE')} → **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
                            } else {
                                precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
                            }
                            const detalles = [
                                m.area_total ? `${m.area_total}m²` : '',
                                m.view ? `vista ${m.view}` : '',
                                m.floor ? `piso ${m.floor}` : ''
                            ].filter(Boolean).join(', ');

                            respuestaCompleta += `${idx + 1}. Unidad ${m.unit_number} - ${detalles} - ${precioMostrar}\n`;
                        });
                        respuestaCompleta += '\n';
                    });

                    if (dormitoriosSinResultados.length > 0) {
                        const missingLabels = dormitoriosSinResultados.map(d => d === 0 ? 'Monoambiente' : `${d} dorms`);
                        respuestaCompleta += `Por el momento **no tengo disponibles**: ${missingLabels.join(' ni ')}.\n\n`;
                    }

                    respuestaCompleta += `¿Te interesa alguna de estas opciones? Puedo enviarte planos y mas detalles.`;
                    return respuestaCompleta;
                }

                this.logger.warn(`${logPrefix} No hubo coincidencias en ninguno de los dormitorios solicitados: ${paramsInternal.dormitorios.join(', ')}`);
                const allLabels = paramsInternal.dormitorios.map(d => d === 0 ? 'Monoambiente' : `${d} dorms`);
                return `[ACCION_COMPLETADA] Lo siento, no encontre departamentos disponibles de ${allLabels.join(' ni ')} en este momento. ¿Te gustaria ver otras opciones?`;
            }

            let dormsNumber = typeof paramsInternal.dormitorios === 'number' ? paramsInternal.dormitorios :
                (Array.isArray(paramsInternal.dormitorios) && paramsInternal.dormitorios.length > 0 ? paramsInternal.dormitorios[0] : undefined);

            const simpleParams = { ...params, dormitorios: dormsNumber };


            // INTENTO 1: Busqueda Exacta
            this.logger.log(`${logPrefix} Intento 1: Filtros exactos`);
            let resultado = await this.ejecutarBusquedaQdrant(collectionName, simpleParams, params.preferencia_piso);

            this.logger.log(`${logPrefix} Intento 1 - Resultados: ${resultado.items.length}`);

            if (resultado.ok && resultado.items.length > 0) {
                return this.formatearRespuestaBusqueda(resultado.items, "Encontre estas opciones exactas para ti:");
            }

            // INTENTO 2: Relajar filtros secundarios (Vista y Tipologia) - NUNCA relajar tipo_unidad
            this.logger.log(`${logPrefix} Intento 2: Relajando Vista y Tipologia`);
            const paramsRelaxed1 = { ...simpleParams };
            delete paramsRelaxed1.vista;
            delete paramsRelaxed1.tipologia;
            // Si piden area_min, relajamos un 10%
            if (paramsRelaxed1.area_min) paramsRelaxed1.area_min = paramsRelaxed1.area_min * 0.9;

            resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsRelaxed1, params.preferencia_piso);

            if (resultado.ok && resultado.items.length > 0) {
                return this.formatearRespuestaBusqueda(resultado.items,
                    "No encontre opciones exactas con esa vista/tipo especificos, pero estas alternativas cumplen con dormitorios y presupuesto:");
            }

            // INTENTO 3: Relajar Presupuesto (Smart Range +/- 20%)
            this.logger.log(`${logPrefix} Intento 3: Relajando Presupuesto`);
            const paramsRelaxed2 = { ...paramsRelaxed1 };
            if (paramsRelaxed2.precio_max) paramsRelaxed2.precio_max = paramsRelaxed2.precio_max * 1.2; // +20%
            if (paramsRelaxed2.precio_min) paramsRelaxed2.precio_min = paramsRelaxed2.precio_min * 0.8; // -20%

            resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsRelaxed2, params.preferencia_piso);

            if (resultado.ok && resultado.items.length > 0) {
                return this.formatearRespuestaBusqueda(resultado.items,
                    "No encontre en el rango exacto de precio, pero estas opciones estan muy cerca:");
            }

            // INTENTO 3.5: Si pidieron tipologia que no existe, listar las disponibles
            if (simpleParams.tipologia) {
                this.logger.log(`${logPrefix} Intento 3.5: Listar tipologias disponibles`);
                const paramsSinTipologia = { ...simpleParams };
                delete paramsSinTipologia.tipologia;
                delete paramsSinTipologia.vista;
                delete paramsSinTipologia.area_min;

                resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsSinTipologia, params.preferencia_piso);

                if (resultado.ok && resultado.items.length > 0) {
                    // Extraer tipologias unicas disponibles
                    const tipologiasDisponibles = [...new Set(
                        resultado.items.map(i => i.document.metadata.typology).filter(Boolean)
                    )];

                    return this.formatearRespuestaBusqueda(resultado.items,
                        `No encontre exactamente "${simpleParams.tipologia}", pero aqui estan las opciones disponibles (tipologias: ${tipologiasDisponibles.join(', ')}):`);
                }
            }

            // INTENTO 4: Fallback Final - Solo Dormitorios (Lo mas importante)
            if (dormsNumber !== undefined) {
                this.logger.log(`${logPrefix} Intento 4: Solo Dormitorios`);
                const paramsFinal: any = { dormitorios: dormsNumber };
                if (params.tipo_unidad) paramsFinal.tipo_unidad = params.tipo_unidad;
                resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsFinal, params.preferencia_piso);

                if (resultado.ok && resultado.items.length > 0) {
                    const label = dormsNumber === 0 ? "tipo Monoambiente" : `de ${dormsNumber} dormitorios`;
                    return this.formatearRespuestaBusqueda(resultado.items,
                        `No tengo coincidencias exactas con todos los filtros, pero aqui estan departamentos ${label}:`);
                }
            }

            // INTENTO 5: Ultra-fallback - Listar todo sin filtros especificos (solo semantico)
            this.logger.log(`${logPrefix} Intento 5: Busqueda semantica sin filtros estrictos`);
            const ultraFallbackFilters: any = {};
            if (params.tipo_unidad) {
                let tipo = params.tipo_unidad.toString().trim();
                // Normalizacion para Dúplex
                if (tipo.toLowerCase() === 'duplex') {
                    tipo = 'Dúplex';
                }
                ultraFallbackFilters.tipoUnidad = tipo;
            }
            const allResults = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                'departamento disponible',
                ultraFallbackFilters,
                { limit: 10, threshold: 0.3, fallbackStrategy: 'none' }
            );

            if (allResults.length > 0) {
                const tipologiasDisponibles = [...new Set(
                    allResults.map(i => i.document.metadata.typology).filter(Boolean)
                )].sort();

                const lista = allResults.slice(0, 6).map((r, idx) => {
                    const m = r.document.metadata;
                    const pList = m.price_list ? parseFloat(m.price_list) : 0;
                    const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;
                    const fechaLimite = new Date('2025-01-01');
                    const mostrarPromos = new Date() < fechaLimite;

                    let precioMostrar = '';
                    if (mostrarPromos && pPromo && pPromo < pList) {
                        precioMostrar = `S/${pList.toLocaleString('es-PE')} -> **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
                    } else {
                        precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
                    }
                    const detalles = [
                        m.bedrooms ? `${m.bedrooms} dorm` : '',
                        m.area_total ? `${m.area_total}m2` : '',
                        m.view ? `Vista ${m.view}` : '',
                        m.typology ? `${m.typology}` : ''
                    ].filter(Boolean).join(', ');
                    return `${idx + 1}. Unidad ${m.unit_number} - ${detalles} - ${precioMostrar}`;
                }).join('\n');

                return `[ACCION_COMPLETADA] No encontré departamentos de ${dormsNumber} dormitorios tipo ${params.tipo_unidad || ''}, pero aquí tienes las opciones disponibles (tipologias: ${tipologiasDisponibles.join(', ')}):\n\n${lista}\n\n<<INSTRUCCION_IA: Pregunta por una tipologia especifica o cuantos dormitorios busca.>>`;
            }

            return "[ACCION_COMPLETADA] Lo siento, no encontre nada disponible ni siquiera relajando la busqueda. <<INSTRUCCION_IA: Pregunta si quiere ver departamentos de otra cantidad de dormitorios.>>";

        } catch (error) {
            if (error.message === 'PROYECTO_NO_SELECCIONADO') {
                return "[INFO_FALTANTE] No tengo un proyecto seleccionado en este momento. <<INSTRUCCION_IA: Pregúntale al cliente en qué proyecto específico está buscando el departamento.>>";
            }
            this.logger.error(`Error en buscarDepartamentoUniversal: ${error.message}`, error.stack);
            return "Ocurrio un error tecnico al buscar. Por favor intenta de nuevo.";
        }
    }

    // --- MÉTODOS PRIVADOS DE AYUDA ---

    private async manejarBusquedaPorUnidad(params: any, collectionName: string) {
        const queryText = `unidad ${params.unidad}`;
        const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
            collectionName,
            queryText,
            {},
            { limit: 20, threshold: 0.3 }
        );

        const unidadExacta = resultados.find(r =>
            r.document.metadata.unit_number?.toString() === params.unidad?.toString()
        );

        if (unidadExacta) {
            const m = unidadExacta.document.metadata;
            await this.enviarPlanoSiCorresponde(m, params);
            return await this.formatearDetalleUnidad(m, params);
        }

        return `[ACCION_COMPLETADA] No encontré la unidad ${params.unidad}. Revisa si el número es correcto.`;
    }

    private async ejecutarBusquedaQdrant(collectionName: string, params: any, preferenciaPiso?: 'bajos' | 'altos') {
        // Construir query text
        const queryParts = ['departamento disponible'];
        if (params.dormitorios) queryParts.push(`${params.dormitorios} dormitorios`);
        if (params.vista) queryParts.push(`vista ${params.vista}`);
        const queryText = queryParts.join(' ');

        // Construir filtros
        const filters: any = {};
        if (params.dormitorios !== undefined) filters.dormitorios = params.dormitorios;
        if (params.piso !== undefined) {
            filters.pisoMin = params.piso;
            filters.pisoMax = params.piso;
        }
        if (params.precio_min !== undefined) filters.precioMin = params.precio_min;
        if (params.precio_max !== undefined) filters.precioMax = params.precio_max;
        if (params.vista) filters.vista = params.vista;
        if (params.tipo_unidad) {
            let tipo = params.tipo_unidad.toString().trim();
            // Normalizacion para Dúplex (Qdrant tiene "Dúplex" con tilde)
            if (tipo.toLowerCase() === 'duplex') {
                tipo = 'Dúplex';
            }
            filters.tipoUnidad = tipo;
        }

        if (params.tipologia) {
            let tipologiaNormalizada = params.tipologia.toString().trim();
            if (!tipologiaNormalizada.toLowerCase().startsWith('tipo')) {
                tipologiaNormalizada = `Tipo ${tipologiaNormalizada}`;
            } else {
                // Capitalizar correctamente: "tipo 5" → "Tipo 5" en caso cuando viee solo numero 
                tipologiaNormalizada = tipologiaNormalizada.replace(/^tipo/i, 'Tipo');
            }
            filters.tipologia = tipologiaNormalizada;
            this.logger.debug(`[Tipología normalizada] "${params.tipologia}" → "${tipologiaNormalizada}"`);
        }

        if (params.area_min !== undefined) filters.areaMin = params.area_min;

        // Aumentamos límite para poder reordenar en memoria por precio
        const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
            collectionName,
            queryText,
            filters,
            { limit: 20, threshold: 0.4 }
        );

        // LÓGICA DE ORDENAMIENTO INTELIGENTE
        // Prioridad 1: Si especificó preferencia de piso
        if (preferenciaPiso) {
            resultados.sort((a, b) => {
                const pisoA = a.document.metadata.floor || 0;
                const pisoB = b.document.metadata.floor || 0;

                if (preferenciaPiso === 'bajos') {
                    return pisoA - pisoB; // Menor a mayor (piso 1, 2, 3...)
                } else {
                    return pisoB - pisoA; // Mayor a menor (piso 17, 16, 15...)
                }
            });
            this.logger.log(`[BusquedaUniversal] Resultados ordenados por pisos ${preferenciaPiso}: ${preferenciaPiso === 'bajos' ? 'ascendente' : 'descendente'}`);
        }
        // Prioridad 2: Si el usuario especificó precio (max o min), ordenamos por cercanía a ese precio
        else if (params.precio_max || params.precio_min) {
            const precioObjetivo = params.precio_max || params.precio_min;

            resultados.sort((a, b) => {
                const getPrecio = (item: any) => {
                    const m = item.document.metadata;
                    // Usar precio promo si existe y es menor, sino precio lista
                    const pPromo = m.price_promo ? parseFloat(m.price_promo) : null;
                    const pList = m.price_list ? parseFloat(m.price_list) : 0;
                    return (pPromo && pPromo < pList) ? pPromo : pList;
                };

                const precioA = getPrecio(a);
                const precioB = getPrecio(b);

                const distA = Math.abs(precioA - precioObjetivo);
                const distB = Math.abs(precioB - precioObjetivo);

                return distA - distB; // Menor distancia primero
            });

            this.logger.log(`[BusquedaUniversal] Resultados reordenados por cercanía a precio: ${precioObjetivo}`);
        }

        // Devolvemos solo los top 6 después de ordenar
        return { ok: true, items: resultados.slice(0, 6) };
    }

    private formatearRespuestaBusqueda(items: any[], mensajeIntro: string) {
        const lista = items.slice(0, 3).map((r, idx) => {
            const m = r.document.metadata;

            const pList = m.price_list ? parseFloat(m.price_list) : 0;
            const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;

            // Validacion temporal: Ocultar promos si la fecha actual > 2025 (simulando espera de data nueva)
            const fechaLimite = new Date('2025-01-01');
            const mostrarPromos = new Date() < fechaLimite;

            let precioMostrar = '';
            if (mostrarPromos && pPromo && pPromo < pList) {
                // Mostrar ambos precios para que el cliente vea que SI existe el de lista
                precioMostrar = `S/${pList.toLocaleString('es-PE')} -> **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
            } else {
                precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
            }

            const area = m.area_total ? `${m.area_total}m2` : '';
            const piso = m.floor ? `Piso ${m.floor}` : '';
            const vista = m.view ? `Vista ${m.view}` : '';
            const dorms = m.bedrooms ? `${m.bedrooms} dorm` : '';

            // Construir linea resumen compacta
            // Ej: 1. Unidad 1704 - 2 dorm, 65m2, Vista Calle - S/450,000
            const detalles = [dorms, area, vista, piso].filter(Boolean).join(', ');
            return `${idx + 1}. Unidad ${m.unit_number} - ${detalles} - ${precioMostrar}`;
        }).join('\n');

        return `[ACCION_COMPLETADA] ${mensajeIntro}\n\n${lista}\n\n<<INSTRUCCION_IA: Lista estas opciones tal como vienen, sin autoelegir ninguna. Pregunta cual de estas opciones prefiere o si quiere ver mas alternativas. NO pidas nombre, DNI, proforma ni visita hasta que el cliente elija una unidad.>>`;
    }

    private async resolverNombreProyectoUnidad(m: any, params: any): Promise<string> {
        if (m.project_name?.trim()) {
            return m.project_name.trim();
        }

        if (params?.nombre_proyecto?.trim()) {
            return params.nombre_proyecto.trim();
        }

        const proyectoId = m.project_id || params?.proyectoId || null;
        if (proyectoId) {
            const proyecto = await this.proyectosRepo.findOne({
                where: { id: proyectoId }
            });
            if (proyecto?.nombre?.trim()) {
                return proyecto.nombre.trim();
            }
        }

        if (params?.leadUuid && params?.codigoEmpresa) {
            const sesion = await this.sesionRepo.findOne({
                where: { leadUuid: params.leadUuid, codigoEmpresa: params.codigoEmpresa }
            });

            if (sesion?.proyectoId) {
                const proyectoSesion = await this.proyectosRepo.findOne({
                    where: { id: sesion.proyectoId, codigoEmpresa: params.codigoEmpresa }
                });
                if (proyectoSesion?.nombre?.trim()) {
                    return proyectoSesion.nombre.trim();
                }
            }
        }

        return 'Proyecto ';
    }

    private async formatearDetalleUnidad(m: any, params: any) {
        // Formatear precio mostrando lista y promocion si existe
        const pList = m.price_list ? parseFloat(m.price_list) : 0;
        const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;
        const nombreProyecto = await this.resolverNombreProyectoUnidad(m, params);

        const fechaLimite = new Date('2025-01-01');
        const mostrarPromos = new Date() < fechaLimite;

        let precioTexto = '';
        if (mostrarPromos && pPromo && pPromo < pList) {
            precioTexto = `Precio lista: S/${pList.toLocaleString('es-PE')} | Precio oferta: S/${pPromo.toLocaleString('es-PE')}`;
        } else {
            precioTexto = `S/${pList.toLocaleString('es-PE')}`;
        }

        // Construir detalle completo con TODOS los campos disponibles
        const detalles: string[] = [
            `[ACCION_COMPLETADA] **Unidad ${m.unit_number}**`,
            `- Proyecto: ${nombreProyecto}`,
            `- Tipo: ${m.unit_type || 'Departamento'} (${m.typology || 'Standard'})`,
            `- Piso: ${m.floor}`,
            `- Dormitorios: ${m.bedrooms}`,
            `- Area total: ${m.area_total}m2`,
            `- Vista: ${m.view}`,
            `- Precio: ${precioTexto}`,
            `- Disponibilidad: ${m.availability || 'Disponible'}`,
        ];

        if (m.bathrooms) detalles.push(`- Banos: ${m.bathrooms}`);
        if (m.parking) detalles.push(`- Estacionamiento: ${m.parking}`);
        if (m.storage) detalles.push(`- Deposito: ${m.storage}`);

        detalles.push('');
        detalles.push('<<INSTRUCCION_IA: Ya se envio el plano al cliente. Muestra TODOS los datos de arriba en tu respuesta y continua con el flujo de venta.>>');

        return detalles.join('\n');
    }

    private async enviarPlanoSiCorresponde(m: any, params: any) {
        if (!params.phoneNumber || !m.url_floor_plan) return;

        const imageUrl = convertGoogleDriveToDirectUrl(m.url_floor_plan);
        if (!imageUrl) return;

        try {
            await this.wapiService.sendImageByUrl(
                params.codigoEmpresa || 1,
                params.phoneNumber,
                imageUrl,
                `Plano Unidad ${m.unit_number}`
            );

            // Logear en inbox si es posible
            if (params.leadUuid) {
                await this.inboxService.guardarMensajeBot({
                    leadUuid: params.leadUuid,
                    codigoEmpresa: params.codigoEmpresa || 1,
                    contenido: `Plano Unidad ${m.unit_number}`,
                    tipoMultimedia: 'image',
                    urlMultimedia: imageUrl,
                    estadoMensaje: 'enviado'
                }).catch(e => this.logger.error(e));
            }
        } catch (e) {
            this.logger.error("Error enviando plano", e);
        }
    }

    async buscarInmueble(params: { dormitorios?: number, precio_max?: number }) {
        return this.mostrarDepartamentos({ dormitorios: params.dormitorios });
    }

    async enviarBrochure(params: {
        nombre_proyecto: string;
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            let fileName = 'brochure-los-lirios.pdf'; // fallback
            if (params.nombre_proyecto) {
                const nombreNormalizado = params.nombre_proyecto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (nombreNormalizado.includes('cerezo')) {
                    fileName = 'brochure_los_cerezos.pdf';
                } else if (nombreNormalizado.includes('porta') || nombreNormalizado.includes('360')) {
                    fileName = 'brochure_porta_360.pdf';
                } else if (nombreNormalizado.includes('lirio')) {
                    fileName = 'brochure-los-lirios.pdf';
                }
            }

            const path = require('path');
            const brochurePath = path.join(process.cwd(), 'storage', 'multimedia', fileName);

            if (!params.phoneNumber || !params.leadUuid) {
                return `Aqui esta el brochure del proyecto ${params.nombre_proyecto}`;
            }

            const codigoEmpresa = params.codigoEmpresa || 1;

            // Enviar el PDF por WhatsApp
            const response: any = await this.wapiService.sendDocument(
                codigoEmpresa,
                params.phoneNumber,
                brochurePath,
                `Brochure del proyecto ${params.nombre_proyecto}`
            );

            this.logger.log(`Brochure enviado a ${params.phoneNumber}`);

            let wamid = null;
            let estado = 'enviado';
            let errorDetails = null;

            if (response && response.error) {
                estado = 'fallido';
                errorDetails = response.details;
            } else {
                wamid = response?.messages?.[0]?.id || response?.id || null;
            }

            // Guardar el mensaje en la base de datos para el inbox
            // Usar ruta relativa web para que el frontend pueda renderizar
            const urlRelativa = `/storage/multimedia/${fileName}`;
            await this.inboxService.guardarMensajeBot({
                leadUuid: params.leadUuid,
                codigoEmpresa: codigoEmpresa,
                contenido: `Brochure del proyecto ${params.nombre_proyecto}`,
                tipoMultimedia: 'document',
                urlMultimedia: urlRelativa,
                wamid: wamid,
                estadoMensaje: estado,
                errorWapi: errorDetails
            });

            return `[ACCION_COMPLETADA] Brochure del proyecto ${params.nombre_proyecto} enviado exitosamente al cliente. <<INSTRUCCION_IA: No ejecutes esta herramienta de nuevo. Continua con tu mensaje de seguimiento.>>`;

        } catch (error) {
            this.logger.error(`Error enviando brochure: ${error.message}`);
            return `Hubo un error al enviar el brochure. Por favor intenta de nuevo.`;
        }
    }

    async enviarMapa(params: {
        nombre_proyecto: string;
        unidad_id: string;
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            const collectionName = await this.obtenerColeccionInventario(null);

            // Buscar la unidad en Qdrant
            let resultados = [];
            try {
                resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                    collectionName,
                    `unidad ${params.unidad_id}`,
                    {},
                    { limit: 20, threshold: 0.3 }
                );
            } catch (qdrantError) {
                this.logger.warn(`Error buscando unidad en Qdrant: ${qdrantError.message}`);
                return `No encontré información de la unidad ${params.unidad_id}`;
            }

            // Encontrar unidad exacta
            const unidadExacta = resultados.find(r =>
                r.document.metadata.unit_number?.toString() === params.unidad_id?.toString()
            );

            if (!unidadExacta) {
                return `No encontré información de la unidad ${params.unidad_id}`;
            }

            const metadata = unidadExacta.document.metadata;

            // Enviar imagen del plano si existe
            if (params.phoneNumber && metadata.url_floor_plan) {
                const imageUrl = convertGoogleDriveToDirectUrl(metadata.url_floor_plan);
                const codigoEmpresa = params.codigoEmpresa || 1;
                if (imageUrl) {
                    try {
                        const response: any = await this.wapiService.sendImageByUrl(
                            codigoEmpresa,
                            params.phoneNumber,
                            imageUrl,
                            `Plano de la unidad ${params.unidad_id}`
                        );
                        this.logger.log(`✅ Plano enviado para unidad ${params.unidad_id}`);

                        let estado = 'enviado';
                        let errorDetails = null;

                        if (response && response.error) {
                            estado = 'fallido';
                            errorDetails = response.details;
                        }

                        // Guardar mensaje en BD si tenemos leadUuid
                        if (params.leadUuid) {
                            try {
                                await this.inboxService.guardarMensajeBot({
                                    leadUuid: params.leadUuid,
                                    codigoEmpresa: codigoEmpresa,
                                    contenido: `Plano de la unidad ${params.unidad_id}`,
                                    tipoMultimedia: 'image',
                                    urlMultimedia: imageUrl,
                                    estadoMensaje: estado,
                                    errorWapi: errorDetails
                                });
                                this.logger.log(`💾 Mensaje con imagen guardado en BD - Unidad ${params.unidad_id}`);
                            } catch (dbError) {
                                this.logger.error(`Error guardando mensaje en BD: ${dbError.message}`);
                            }
                        }

                        return `[ACCION_COMPLETADA] Plano del departamento ${params.unidad_id} enviado exitosamente. <<INSTRUCCION_IA: No ejecutes esta herramienta de nuevo.>>`;
                    } catch (error) {
                        this.logger.error(`Error enviando plano: ${error.message}`);
                        return `[ACCION_COMPLETADA] Tuve un problema enviando el plano. Aqui esta el link: ${metadata.url_floor_plan}`;
                    }
                }
            }

            // Si no hay phoneNumber o url_floor_plan
            return metadata.url_floor_plan
                ? `Aquí está el link del plano: ${metadata.url_floor_plan}`
                : `[ACCION_COMPLETADA] No tengo el plano de la unidad ${params.unidad_id} disponible. <<INSTRUCCION_IA: No inventes disponibilidad de plano ni insistas con el mismo envio. Si el cliente necesita ese plano para decidir, activa modo contencion y ofrece agendar una visita para que lo atienda un asesor.>>`;

        } catch (error) {
            this.logger.error(`Error en enviarMapa: ${error.message}`);
            return `[ACCION_COMPLETADA] Ocurrio un error al buscar el plano de la unidad ${params.unidad_id}. <<INSTRUCCION_IA: No reintentes automaticamente ni pidas la misma confirmacion varias veces. Explica la limitacion una sola vez y ofrece continuar con otra unidad o agendar una visita para que un asesor lo atienda.>>`;
        }
    }

    /**
     * Envía la ubicación del proyecto en Google Maps
     */
    async enviarUbicacionGoogleMaps(params: { nombre_proyecto: string, unidad_id?: string }) {
        try {
            const collectionName = await this.obtenerColeccionInventario(null);
            const buildFaqQuery = () => ([
                `¿Dónde se encuentra ubicado el proyecto ${params.nombre_proyecto}?`,
                `ubicación del proyecto ${params.nombre_proyecto}`,
                `dirección del proyecto ${params.nombre_proyecto}`,
            ]);

            // Buscar cualquier unidad del proyecto para obtener url_location
            const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                params.nombre_proyecto,
                {},
                { limit: 1, threshold: 0.3 }
            );

            if (resultados.length === 0) {
                return `No encontré información del proyecto ${params.nombre_proyecto}`;
            }

            const urlLocation = resultados[0].document.metadata.url_location;

            if (!urlLocation) {
                return this.buscarPreguntasFrecuentes({
                    queries_de_busqueda: buildFaqQuery(),
                    nombre_proyecto: params.nombre_proyecto
                });
            }

            return `[ACCION_COMPLETADA] Ubicacion del proyecto ${params.nombre_proyecto}: ${urlLocation}.`;

        } catch (error) {
            this.logger.error(`Error en enviarUbicacionGoogleMaps: ${error.message}`);
            return this.buscarPreguntasFrecuentes({
                queries_de_busqueda: [
                    `¿Dónde se encuentra ubicado el proyecto ${params.nombre_proyecto}?`,
                    `ubicación del proyecto ${params.nombre_proyecto}`,
                    `dirección del proyecto ${params.nombre_proyecto}`,
                ],
                nombre_proyecto: params.nombre_proyecto
            });
        }
    }

    /**
     * Envía los videos promocionales del proyecto por WhatsApp.
     * Envía automáticamente AMBOS videos disponibles en storage/videos.
     */
    async enviarVideosProyecto(params: {
        nombre_proyecto: string;
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            const path = require('path');
            const fs = require('fs');

            // Rutas de los videos del proyecto
            const videosDir = path.join(process.cwd(), 'storage', 'videos');
            const videosDisponibles = [
                { archivo: 'LIRIOS_TIPOLOGIAS_6_final.mp4', descripcion: 'Video de tipologías del proyecto' },
                { archivo: 'lirios_tipo_3_final.mp4', descripcion: 'Video promocional del proyecto' }
            ];

            // Validar parámetros mínimos para enviar
            if (!params.phoneNumber || !params.leadUuid) {
                return `[ACCION_COMPLETADA] Los videos del proyecto ${params.nombre_proyecto} están disponibles. Proporciona tu número para enviártelos.`;
            }

            const codigoEmpresa = params.codigoEmpresa || 1;
            const videosEnviados: string[] = [];
            const erroresEnvio: string[] = [];

            // Enviar cada video secuencialmente
            for (const video of videosDisponibles) {
                const rutaVideo = path.join(videosDir, video.archivo);

                // Verificar que el archivo existe
                if (!fs.existsSync(rutaVideo)) {
                    this.logger.warn(`[EnviarVideos] Archivo no encontrado: ${rutaVideo}`);
                    erroresEnvio.push(video.archivo);
                    continue;
                }

                try {
                    const response: any = await this.wapiService.sendVideo(
                        codigoEmpresa,
                        params.phoneNumber,
                        rutaVideo,
                        video.descripcion
                    );

                    let wamid = null;
                    let estado = 'enviado';
                    let errorDetails = null;

                    if (response && response.error) {
                        estado = 'fallido';
                        errorDetails = response.details;
                        erroresEnvio.push(video.archivo);
                    } else {
                        wamid = response?.messages?.[0]?.id || response?.id || null;
                        videosEnviados.push(video.archivo);
                    }

                    // Registrar en inbox con ruta relativa web para que el frontend pueda renderizar
                    const urlRelativaVideo = `/storage/videos/${video.archivo}`;
                    await this.inboxService.guardarMensajeBot({
                        leadUuid: params.leadUuid,
                        codigoEmpresa: codigoEmpresa,
                        contenido: video.descripcion,
                        tipoMultimedia: 'video',
                        urlMultimedia: urlRelativaVideo,
                        wamid: wamid,
                        estadoMensaje: estado,
                        errorWapi: errorDetails
                    });

                    this.logger.log(`[EnviarVideos] Video enviado: ${video.archivo}`);

                } catch (videoError) {
                    this.logger.error(`[EnviarVideos] Error enviando ${video.archivo}: ${videoError.message}`);
                    erroresEnvio.push(video.archivo);
                }
            }

            // Generar respuesta según resultados
            if (videosEnviados.length === videosDisponibles.length) {
                return `[ACCION_COMPLETADA] Videos del proyecto ${params.nombre_proyecto} enviados exitosamente. <<INSTRUCCION_IA: No ejecutes esta herramienta de nuevo. Pregunta que le parecieron los videos.>>`;
            } else if (videosEnviados.length > 0) {
                return `[ACCION_COMPLETADA] Se enviaron ${videosEnviados.length} de ${videosDisponibles.length} videos. Algunos tuvieron problemas, pero ya tienes material para revisar.`;
            } else {
                return `Hubo un problema al enviar los videos. Por favor intenta de nuevo más tarde.`;
            }

        } catch (error) {
            this.logger.error(`[EnviarVideos] Error general: ${error.message}`);
            return `Hubo un error al enviar los videos del proyecto. Por favor intenta de nuevo.`;
        }
    }

    /**
     * Descarta un cliente que se molestó o pidió no ser contactado
     * Clasifica como "descartado" y cierra la sesión para evitar futuras plantillas
     */
    async descartarCliente(params: {
        motivo: string;
        leadUuid: string;
        codigoEmpresa: number;
    }) {
        try {
            this.logger.log(`Descartando cliente: ${params.leadUuid} - Motivo: ${params.motivo}`);

            // 1. Buscar sesión activa
            const sesion = await this.sesionRepo.findOne({
                where: {
                    leadUuid: params.leadUuid,
                    codigoEmpresa: params.codigoEmpresa
                }
            });

            if (!sesion) {
                this.logger.warn(`No se encontró sesión para lead: ${params.leadUuid}`);
                return {
                    success: false,
                    mensaje: "No se pudo procesar la solicitud."
                };
            }

            // 2. Insertar clasificación como DESCARTADO
            const clasificacion = this.clasificacionRepo.create({
                idSesion: sesion.id,
                clasificacion: 'descartado',
                razon: `Cliente descartado: ${params.motivo}`,
            });
            await this.clasificacionRepo.save(clasificacion);

            // 3. Actualizar estado de sesión a 2 (cerrado)
            sesion.idEstado = 2;
            sesion.proximoMensajeMinutos = 0; // Detener plantillas
            await this.sesionRepo.save(sesion);

            // 4. Registrar en resumen
            await this.resumenService.agregarPunto(
                params.leadUuid,
                params.codigoEmpresa,
                `Cliente descartado: ${params.motivo}`
            );

            this.logger.log(`Cliente descartado exitosamente - Lead: ${params.leadUuid}`);

            return {
                success: true,
                mensaje: "[ACCION_COMPLETADA] Entendido. Lamento las molestias. No volverás a recibir mensajes nuestros. Que tengas un excelente día."
            };

        } catch (error) {
            this.logger.error(`Error descartando cliente: ${error.message}`);
            return {
                success: false,
                mensaje: "Disculpa las molestias. Entendido, no te contactaremos más."
            };
        }
    }

    /**
     * Corrige errores ortográficos y normaliza ocupaciones usando LLM
     */
    private async corregirOcupacion(ocupacion: string): Promise<string> {
        if (!ocupacion) return ocupacion;

        try {
            const OcupacionSchema = z.object({
                ocupacion_normalizada: z.string().describe('La ocupación corregida y con mayúsculas capitalizadas, ej: "Ingeniero De Sistemas"')
            });

            const extractor = this.llm.withStructuredOutput(OcupacionSchema);
            const prompt = `Corrige la ortografía y normaliza esta ocupación profesional: "${ocupacion}". Si no es una ocupación clara, devuélvela como está pero capitalizada. Ejemplo: "ing sistemas" -> "Ingeniero de Sistemas".`;

            const result = await extractor.invoke(prompt);
            return result.ocupacion_normalizada;

        } catch (error) {
            this.logger.warn(`Error corrigiendo ocupación con LLM: ${error.message}`);
            // Fallback simple: Capitalizar
            return ocupacion.trim().replace(/\b\w/g, c => c.toUpperCase());
        }
    }

}
