import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';
import { HistorialClasificacionLead } from '../../clasificacion-leads/entities/historial-clasificacion-lead.entity';
import { TimeUtils } from '../../../common/utils/time.utils';
import { z } from 'zod';
import { TokenTrackingService } from '../../ia/token-tracking.service';

/**
 * Servicio que clasifica automáticamente como "MEDIO"  a los leads
 * basándose en el análisis del resumen de conversación mediante GPT-4.
 */
@Injectable()
export class ClasificacionTibioTasksService {
    private readonly logger = new Logger(ClasificacionTibioTasksService.name);
    private llm: ChatOpenAI;

    constructor(
        @InjectRepository(SesionConversacion)
        private sesionRepo: Repository<SesionConversacion>,
        @InjectRepository(HistorialClasificacionLead)
        private clasificacionRepo: Repository<HistorialClasificacionLead>,
        private dataSource: DataSource,
        private configService: ConfigService,
        private tokenTrackingService: TokenTrackingService,
    ) {
        // Inicializar LLM para análisis
        this.llm = new ChatOpenAI({
            modelName: 'gpt-4.1-mini',
            temperature: 0,
            openAIApiKey: this.configService.get('OPENAI_API_KEY'),
        });
    }

    /**
     * Cron que se ejecuta cada 1 hora para monitorear inactividad
     */
    @Cron(CronExpression.EVERY_10_HOURS)
    async clasificarLeadsTibios() {
        // Validación de horario operativo
        if (!TimeUtils.isWithinOperatingHours()) {
            this.logger.debug('Fuera de horario operativo. Cron pausado.');
            return;
        }

        this.logger.log('Verificando leads inactivos para posible clasificación...');

        try {
            // Definir tiempo de inactividad (20 minutos atrás)

            const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

            // Buscar sesiones activas (estado 1) que tengan un resumen significativo
            // Y que SU ÚLTIMO MENSAJE haya sido hace más de 20 minutos
            const sesiones = await this.sesionRepo
                .createQueryBuilder('sesion')
                .where('sesion.id_estado = :estado', { estado: 1 })
                .andWhere('sesion.resumen_conversacion IS NOT NULL')
                .andWhere('LENGTH(sesion.resumen_conversacion) > :minLength', { minLength: 50 })
                .andWhere('sesion.fechaHoraUltimoMsj < :tiempoLimite', { tiempoLimite: twentyMinutesAgo })
                .getMany();

            if (sesiones.length === 0) {

                return;
            }

            this.logger.log(`Encontrados ${sesiones.length} leads inactivos (>20min) para clasificar.`);

            const batchSize = 10;
            for (let index = 0; index < sesiones.length; index += batchSize) {
                const batch = sesiones.slice(index, index + batchSize);
                const resultados = await this.analizarBatchConIA(batch);

                for (const resultado of resultados) {
                    if (!resultado.clasificacion) {
                        continue;
                    }

                    const sesion = batch.find((item) => item.id === resultado.sessionId);
                    if (!sesion) {
                        continue;
                    }

                    await this.clasificarLead(sesion, resultado.clasificacion, resultado.razon);
                }
            }

        } catch (error) {
            this.logger.error('Error en cron de clasificación leads tibios', error);
        }
    }

    private async analizarBatchConIA(sesiones: SesionConversacion[]): Promise<Array<{
        sessionId: number;
        clasificacion: 'medio' | 'alto' | null;
        razon: string;
    }>> {
        const BatchSchema = z.object({
            resultados: z.array(z.object({
                session_id: z.number(),
                clasificacion: z.enum(['alto', 'medio']).nullable(),
                razon: z.string(),
            }))
        });

        const prompt = `
            Analiza estos resúmenes de conversación de leads inmobiliarios y clasifica cada uno.

            CRITERIO ALTO:
            - Quiere comprar dentro de 90 días
            - Y parece tener financiamiento, inicial o capacidad económica encaminada

            CRITERIO MEDIO:
            - Todo lead que sí interactuó y avanzó, pero no cumple lo de ALTO
            - Si respondió preguntas clave y no está frío, clasifícalo como MEDIO

            Devuelve un resultado por cada session_id.

            ${sesiones.map((sesion) => `
[SESSION_ID=${sesion.id}]
${sesion.resumenConversacion}
`).join('\n')}
        `;

        try {
            const extractor = (this.llm as any).withStructuredOutput(BatchSchema, { includeRaw: true });
            const response = await extractor.invoke(prompt);
            const parsed = response?.parsed?.resultados || response?.resultados || [];
            const raw = response?.raw;

            if (raw) {
                const usage = raw?.usage_metadata || raw?.response_metadata?.usage;
                if (usage) {
                    await this.tokenTrackingService.registrar({
                        fase: 'lead_scoring',
                        modelo: raw?.response_metadata?.model_name || 'gpt-4.1-mini',
                        inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
                        outputTokens: usage.completion_tokens || usage.output_tokens || 0,
                        metadatos: { batchSize: sesiones.length, sessionIds: sesiones.map((sesion) => sesion.id) },
                    });
                }
            }

            return sesiones.map((sesion) => {
                const found = parsed.find((item: any) => item.session_id === sesion.id);
                if (!found || (found.clasificacion !== 'alto' && found.clasificacion !== 'medio')) {
                    return {
                        sessionId: sesion.id,
                        clasificacion: null,
                        razon: 'No clasificable por IA',
                    };
                }

                return {
                    sessionId: sesion.id,
                    clasificacion: found.clasificacion,
                    razon: found.razon || 'Clasificación automática',
                };
            });
        } catch (e) {
            this.logger.warn('Fallo structured output con raw, intentando fallback simple...', e);
            try {
                const extractor = this.llm.withStructuredOutput(BatchSchema);
                const response = await extractor.invoke(prompt);
                const parsed = response?.resultados || [];

                return sesiones.map((sesion) => {
                    const found = parsed.find((item: any) => item.session_id === sesion.id);
                    if (!found || (found.clasificacion !== 'alto' && found.clasificacion !== 'medio')) {
                        return {
                            sessionId: sesion.id,
                            clasificacion: null,
                            razon: 'No clasificable por IA',
                        };
                    }

                    return {
                        sessionId: sesion.id,
                        clasificacion: found.clasificacion,
                        razon: found.razon || 'Clasificación automática',
                    };
                });
            } catch (fallbackError) {
                this.logger.error('Error parseando respuesta de IA', fallbackError);
                return sesiones.map((sesion) => ({
                    sessionId: sesion.id,
                    clasificacion: null,
                    razon: 'Error en análisis IA',
                }));
            }
        }
    }

    /**
     * Clasifica la sesión y guarda en historial
     */
    private async clasificarLead(sesion: SesionConversacion, tipo: 'medio' | 'alto', razon: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // 1. Insertar clasificación en historial
            const nuevaClasificacion = this.clasificacionRepo.create({
                idSesion: sesion.id,
                clasificacion: tipo,
                razon: razon,
            });

            await queryRunner.manager.save(nuevaClasificacion);

            // 2. Actualizar estado de la sesión a 2 (procesado/cerrado)
            // Esto evita que el lead sea re-evaluado constantemente por este cron
            await queryRunner.manager.update(SesionConversacion, sesion.id, { idEstado: 2 });

            await queryRunner.commitTransaction();

            this.logger.log(`Lead clasificado como ${tipo.toUpperCase()} - Sesión ID: ${sesion.id}, Lead: ${sesion.leadUuid}, Razón: ${razon}`);

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Error guardando clasificación para sesión ${sesion.id}:`, error);
        } finally {
            await queryRunner.release();
        }
    }
}
