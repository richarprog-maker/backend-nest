import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HistorialChatAi } from './entities/historial-chat-ai.entity';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

@Injectable()
export class HistorialChatService {
    private readonly logger = new Logger(HistorialChatService.name);

    constructor(
        @InjectRepository(HistorialChatAi)
        private historialRepo: Repository<HistorialChatAi>,
    ) {}

    /**
     * Guardar mensaje en el historial
     */
    async guardarMensaje(data: {
        leadUuid: string;
        codigoEmpresa: number;
        mensaje: BaseMessage | { role: string; content: string };
        role: string;
        tknInput?: number;
        tknOutput?: number;
        nombreModelo?: string;
        metadatos?: any;
    }): Promise<HistorialChatAi> {
        try {
            const input = this.messageToJSON(data.mensaje);

            const nuevoMensaje = this.historialRepo.create({
                leadUuid: data.leadUuid,
                codigoEmpresa: data.codigoEmpresa,
                input,
                role: data.role,
                tknInput: data.tknInput || 0,
                tknOutput: data.tknOutput || 0,
                nombreModelo: data.nombreModelo || 'gpt-4o-mini',
                metadatos: data.metadatos || null,
            });

            const resultado = await this.historialRepo.save(nuevoMensaje);
            this.logger.debug(`Mensaje guardado en historial: ID ${resultado.id}, Lead: ${data.leadUuid}, Role: ${data.role}`);
            
            return resultado;
        } catch (error) {
            this.logger.error(`Error guardando mensaje en historial: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Obtener últimos N mensajes de una conversación
     */
    async obtenerUltimosMensajes(
        leadUuid: string,
        codigoEmpresa: number,
        limite: number = 12,
        omitirFunciones: boolean = false
    ): Promise<BaseMessage[]> {
        try {
            const queryBuilder = this.historialRepo
                .createQueryBuilder('historial')
                .where('historial.leadUuid = :leadUuid', { leadUuid })
                .andWhere('historial.codigoEmpresa = :codigoEmpresa', { codigoEmpresa })
                .orderBy('historial.id', 'DESC')
                .limit(limite);

            if (omitirFunciones) {
                queryBuilder.andWhere("historial.role != 'function'");
            }

            const mensajes = await queryBuilder.getMany();

            // Revertir orden para mantener cronología
            const mensajesOrdenados = mensajes.reverse();

            return mensajesOrdenados.map(m => this.convertirABaseMessage(m.input));
        } catch (error) {
            this.logger.error(`Error obteniendo historial: ${error.message}`, error.stack);
            return [];
        }
    }

    /**
     * Obtener historial completo como array simple para pasar al LLM
     */
    async obtenerHistorialParaIA(
        leadUuid: string,
        codigoEmpresa: number,
        limite: number = 12
    ): Promise<{ role: string; content: string }[]> {
        try {
            const mensajes = await this.obtenerUltimosMensajes(leadUuid, codigoEmpresa, limite, true);
            
            return mensajes.map(msg => ({
                role: this.getRole(msg),
                content: this.getContent(msg)
            }));
        } catch (error) {
            this.logger.error(`Error obteniendo historial para IA: ${error.message}`);
            return [];
        }
    }

    /**
     * Convertir BaseMessage a JSON para almacenar en BD
     */
    private messageToJSON(message: any): any {
        if (message instanceof BaseMessage) {
            return {
                role: this.getRole(message),
                content: this.getContent(message),
                type: message._getType(),
                additional_kwargs: message.additional_kwargs || {}
            };
        }
        
        // Si ya es un objeto simple
        return message;
    }

    /**
     * Convertir JSON de BD a BaseMessage de LangChain
     */
    private convertirABaseMessage(input: any): BaseMessage {
        const content = input.content || '';
        
        switch (input.role) {
            case 'user':
            case 'human':
                return new HumanMessage(content);
            case 'assistant':
            case 'ai':
                return new AIMessage(content);
            case 'system':
                return new SystemMessage(content);
            case 'function':
            case 'tool':
                return new ToolMessage({ 
                    content, 
                    tool_call_id: input.additional_kwargs?.tool_call_id || 'unknown'
                });
            default:
                this.logger.warn(`Rol desconocido: ${input.role}, usando HumanMessage`);
                return new HumanMessage(content);
        }
    }

    /**
     * Extraer role de BaseMessage
     */
    private getRole(message: BaseMessage): string {
        const type = message._getType();
        
        switch (type) {
            case 'human': return 'user';
            case 'ai': return 'assistant';
            case 'system': return 'system';
            case 'tool': return 'function';
            default: return type;
        }
    }

    /**
     * Extraer content de BaseMessage
     */
    private getContent(message: BaseMessage): string {
        if (typeof message.content === 'string') {
            return message.content;
        }
        
        if (Array.isArray(message.content)) {
            return message.content
                .map(c => typeof c === 'string' ? c : JSON.stringify(c))
                .join('\n');
        }
        
        return JSON.stringify(message.content);
    }

    /**
     * Contar tokens totales usados en una conversación
     */
    async obtenerEstadisticasTokens(
        leadUuid: string,
        codigoEmpresa: number
    ): Promise<{ totalInput: number; totalOutput: number; totalGeneral: number }> {
        try {
            const resultado = await this.historialRepo
                .createQueryBuilder('historial')
                .select('SUM(historial.tknInput)', 'totalInput')
                .addSelect('SUM(historial.tknOutput)', 'totalOutput')
                .where('historial.leadUuid = :leadUuid', { leadUuid })
                .andWhere('historial.codigoEmpresa = :codigoEmpresa', { codigoEmpresa })
                .getRawOne();

            const totalInput = parseInt(resultado?.totalInput || '0');
            const totalOutput = parseInt(resultado?.totalOutput || '0');

            return {
                totalInput,
                totalOutput,
                totalGeneral: totalInput + totalOutput
            };
        } catch (error) {
            this.logger.error(`Error obteniendo estadísticas: ${error.message}`);
            return { totalInput: 0, totalOutput: 0, totalGeneral: 0 };
        }
    }

    /**
     * Limpiar historial antiguo (opcional, para optimización)
     */
    async limpiarHistorialAntiguo(
        diasRetencion: number = 30
    ): Promise<number> {
        try {
            const fechaLimite = new Date();
            fechaLimite.setDate(fechaLimite.getDate() - diasRetencion);

            const resultado = await this.historialRepo
                .createQueryBuilder()
                .delete()
                .where('created_at < :fechaLimite', { fechaLimite })
                .execute();

            this.logger.log(`Historial limpiado: ${resultado.affected} registros eliminados`);
            return resultado.affected || 0;
        } catch (error) {
            this.logger.error(`Error limpiando historial: ${error.message}`);
            return 0;
        }
    }
}
