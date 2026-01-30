import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptService } from './prompt.service';
import { HistorialChatService } from './historial-chat.service';
import { AgentService } from './agent.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bot } from './entities/bot.entity';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { RedisService } from '../common/redis/redis.service';

@Injectable()
export class AiService {
    private readonly logger = new Logger(AiService.name);

    constructor(
        private configService: ConfigService,
        private promptService: PromptService,
        private historialChatService: HistorialChatService,
        private agentService: AgentService,
        private redisService: RedisService,
        @InjectRepository(Bot)
        private botRepo: Repository<Bot>
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
            const botName = botConfig?.nombre || 'Sofia';
            const botGender = botConfig?.genero || 'female';

            const metadatosEmpresaMock = [{
                nombre_proyecto: "Residencial Los Lirios",
                nombre_empresa: "Inmobiliaria Checor"
            }];
            const resumenProyectosMock = "Residencial Los Lirios: Departamentos de 1, 2 y 3 dormitorios en preventa.";

            // Detectar si hay historial previo para controlar saludo
            const tieneHistorial = historialFormateado.length > 0;

            const systemPrompt = this.promptService.buildSystemPrompt(
                botName,
                botGender,
                metadatosEmpresaMock,
                resumenProyectosMock,
                tieneHistorial
            );

            const resultado = await this.agentService.ejecutarAgente(
                systemPrompt,
                mensajeUsuario,
                historialFormateado,
                {
                    codigoEmpresa,
                    leadUuid,
                    nombreLead: botName, // TODO: Obtener nombre real del lead
                    phoneNumber: phoneNumber, // Número de teléfono para enviar imágenes
                }
            );

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
