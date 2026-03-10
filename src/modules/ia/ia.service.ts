import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptService } from './prompt.service';
import { HistorialChatService } from './historial-chat.service';
import { AgentService } from './agent.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bot } from './entities/bot.entity';
import { Lead } from '../inbox/entities/lead.entity';
import { Cita } from '../citas/entities/cita.entity';
import { SesionConversacion } from './entities/sesion-conversacion.entity';
import { Proyecto } from '../proyectos/entities/proyecto.entity';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { RedisService } from '../common/redis/redis.service';

@Injectable()
export class AiService {
    private readonly logger = new Logger(AiService.name);

    constructor(
        private agentService: AgentService,
        private promptService: PromptService,
        @InjectRepository(Bot)
        private botRepo: Repository<Bot>,
        @InjectRepository(Lead)
        private leadRepo: Repository<Lead>,
        @InjectRepository(Cita)
        private citaRepo: Repository<Cita>,
        @InjectRepository(SesionConversacion)
        private sesionRepo: Repository<SesionConversacion>,
        @InjectRepository(Proyecto)
        private proyectoRepo: Repository<Proyecto>,
        private configService: ConfigService,
        private historialChatService: HistorialChatService,
        private redisService: RedisService,
    ) {
        this.logger.log('AiService inicializado con AgentExecutor');
    }


    async generarRespuesta(
        mensajeUsuario: string,
        historial: BaseMessage[] | any[],
        codigoEmpresa: number,
        leadUuid: string,
        phoneNumber?: string
    ): Promise<string> {
        try {
            this.logger.log(`Procesando mensaje para Lead: ${leadUuid}, Empresa: ${codigoEmpresa}`);

            const isPaused = await this.redisService.isPaused(leadUuid);
            if (isPaused) {
                this.logger.warn(`Chat pausado para lead ${leadUuid}. No se generará respuesta.`);
                return '';
            }

            // Cargar datos del lead para contexto inteligente
            const leadData = await this.leadRepo.findOne({
                where: { uuid: leadUuid, codigoEmpresa }
            });

            // Cargar cita más reciente del lead
            const citaData = await this.citaRepo.findOne({
                where: { leadUuid: leadUuid, codigoEmpresa: codigoEmpresa },
                order: { fechaCita: 'DESC', horaCita: 'DESC' }
            });

            let historialFormateado: BaseMessage[] = [];

            if (!historial || historial.length === 0) {
                this.logger.log(`Cargando últimos 20 mensajes desde BD...`);
                historialFormateado = await this.historialChatService.obtenerUltimosMensajes(
                    leadUuid,
                    codigoEmpresa,
                    20,
                    true
                );
            } else {
                // Convertir historial a BaseMessage[] si es necesario
                historialFormateado = historial as BaseMessage[];
            }

            const modelName = this.configService.get<string>('OPENAI_MODEL') || 'o4-mini';

            await this.historialChatService.guardarMensaje({
                leadUuid,
                codigoEmpresa,
                mensaje: { role: 'user', content: mensajeUsuario },
                role: 'user',
                nombreModelo: modelName,
                metadatos: {
                    codigoEmpresa,
                    leadUuid,
                    timestamp: new Date().toISOString()
                }
            });

            const botConfig = await this.botRepo.findOne({
                where: { codigoEmpresa, habilitado: 1 }
            });
            const botName = botConfig?.nombre || 'Checor advisor';
            const botGender = botConfig?.genero || 'female';

            const sesion = await this.sesionRepo.findOne({
                where: { leadUuid, codigoEmpresa }
            });
            const proyectoId = sesion?.proyectoId || null;

            let metadatosEmpresa: any[] = [];
            let resumenProyectos = '';

            const proyectosActivos = await this.proyectoRepo.find({
                where: { codigoEmpresa, estado: 'activo' }
            });
            metadatosEmpresa = proyectosActivos.map(p => {
                let horarioAtencion = [];
                if (p.jsonData && p.jsonData['horario_atencion']) {
                    try {
                        horarioAtencion = typeof p.jsonData['horario_atencion'] === 'string'
                            ? JSON.parse(p.jsonData['horario_atencion'])
                            : p.jsonData['horario_atencion'];
                    } catch (e) {
                        this.logger.warn(`Error parseando horario para proyecto ${p.id}`);
                    }
                }
                return {
                    id: p.id,
                    nombre_proyecto: p.nombre,
                    nombre_empresa: 'Inmobiliaria Checor',
                    horario_atencion: horarioAtencion,
                };
            });
            resumenProyectos = proyectosActivos.map(p =>
                `${p.nombre}: ${p.descripcion || p.tipoInmueble || 'Proyecto inmobiliario'}`
            ).join('. ');

            const tieneHistorial = historialFormateado.length > 0;

            const systemPrompt = this.promptService.buildSystemPrompt(
                botName,
                botGender,
                metadatosEmpresa,
                resumenProyectos,
                tieneHistorial,
                leadData,
                citaData,
                proyectoId,
                sesion?.resumenConversacion
            );

            const resultado = await this.agentService.ejecutarAgente(
                systemPrompt,
                mensajeUsuario,
                historialFormateado,
                {
                    codigoEmpresa,
                    leadUuid,
                    nombreLead: botName,
                    phoneNumber: phoneNumber,
                    proyectoId: proyectoId,
                }
            );

          
            try {
                if (proyectoId !== null && resultado.toolsEjecutados.includes('guardar_proyecto')) {
                    const respuestaLower = resultado.output.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    let proyectoDetectado: typeof proyectosActivos[0] | null = null;

                    for (const p of proyectosActivos) {
                        const nombreLower = p.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        if (respuestaLower.includes(nombreLower)) {
                            proyectoDetectado = p;
                            break;
                        }
                    }

                    if (proyectoDetectado && proyectoDetectado.id !== proyectoId) {
                        const sesionActual = await this.sesionRepo.findOne({ where: { leadUuid, codigoEmpresa } });
                        if (sesionActual) {
                            sesionActual.proyectoId = proyectoDetectado.id;
                            await this.sesionRepo.save(sesionActual);
                            this.logger.log(
                                `[AutoSync] Proyecto actualizado: ${proyectoId} -> ${proyectoDetectado.id} (${proyectoDetectado.nombre}) para lead ${leadUuid}`
                            );
                        }
                    }
                }
            } catch (syncError) {
                this.logger.warn(`[AutoSync] Error detectando proyecto: ${syncError.message}`);
            }

            await this.historialChatService.guardarMensaje({
                leadUuid,
                codigoEmpresa,
                mensaje: { role: 'assistant', content: resultado.output },
                role: 'assistant',
                tknInput: resultado.tokensUsados?.input || 0,
                tknOutput: resultado.tokensUsados?.output || 0,
                nombreModelo: modelName,
                metadatos: {
                    codigoEmpresa,
                    leadUuid,
                    tools_ejecutados: resultado.toolsEjecutados,
                    timestamp: new Date().toISOString()
                }
            });

            this.logger.log(
                `--->Respuesta generada - Tokens: ${resultado.tokensUsados?.input || 0}/${resultado.tokensUsados?.output || 0}, Tools: ${resultado.toolsEjecutados.join(', ') || 'ninguno'}`
            );

            return resultado.output;

        } catch (error) {
            this.logger.error(`Error generando respuesta IA: ${error.message}`, error.stack);
            return "Lo siento, tuve un problema técnico. ¿Podrías intentar de nuevo?";
        }
    }
}
