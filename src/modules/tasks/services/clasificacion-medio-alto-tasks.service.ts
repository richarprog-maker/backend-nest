import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';
import { HistorialClasificacionLead } from '../../clasificacion-leads/entities/historial-clasificacion-lead.entity';
import { TimeUtils } from '../../../common/utils/time.utils';

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

            for (const sesion of sesiones) {
                await this.analizarYClasificar(sesion);
            }

        } catch (error) {
            this.logger.error('Error en cron de clasificación leads tibios', error);
        }
    }

    /**
     * Analiza una sesión específica y la clasifica si cumple criterios
     */
    private async analizarYClasificar(sesion: SesionConversacion) {
        try {
            // Llamar a GPT-4 para análisis
            const resultado = await this.analizarConIA(sesion.resumenConversacion);

            if (resultado.clasificacion) {
                await this.clasificarLead(sesion, resultado.clasificacion, resultado.razon);
            }
            // Si es null, no hacemos nada

        } catch (error) {
            this.logger.error(`Error analizando sesión ${sesion.id} (${sesion.leadUuid}):`, error);
        }
    }

    /**
     * Utiliza GPT-4 para determinar si el lead es TIBIO o ALTO
     */
    private async analizarConIA(resumen: string): Promise<{ clasificacion: 'medio' | 'alto' | null; razon: string }> {
        const prompt = `
            Analiza el siguiente resumen de conversación de un lead inmobiliario.

            RESUMEN:
            ${resumen}

            OBJETIVO: Clasificar al lead en "alto" (caliente) o "medio" (tibio).
            
            CRITERIOS "ALTO" (Caliente):
            1. Desea comprar DENTRO de los próximos 90 días (menos de 3 meses).
            2. Y menciona contar con cuota inicial o financiamiento listo.
            
            CRITERIOS "MEDIO" (Tibio):
            1. Desea comprar en MÁS de 90 días.
            2. O tiene cuota inicial parcial.
            3. O simplemente ha respondido y avanzado en la conversación (demuestra interés).
            4. CUALQUIER lead que haya interactuado y no sea "ALTO" ni "BAJO" (frío = no responde), debe ser "MEDIO".
            
            IMPORTANTE:
            - Si el lead ha respondido preguntas clave (dormitorios, distrito, etc.), YA NO ES FRÍO. Debe ser clasificado.
            - Si no cumple estrictamente criterios de ALTO, clasifícalo como MEDIO.

            Responde ÚNICAMENTE con el siguiente formato JSON válido:
            {
              "clasificacion": "alto" | "medio" | null,
              "razon": "explicación breve de 1 línea"
            }
        `;

        try {
            const response = await this.llm.invoke(prompt);
            const content = response.content.toString().replace(/```json/g, '').replace(/```/g, '').trim();
            const resultado = JSON.parse(content);

            // Validar que la clasificación sea válida
            if (resultado.clasificacion !== 'alto' && resultado.clasificacion !== 'medio') {
                return { clasificacion: null, razon: 'No clasificable por IA' };
            }

            return resultado;
        } catch (e) {
            this.logger.error('Error parseando respuesta de IA', e);
            return { clasificacion: null, razon: 'Error en análisis IA' };
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
            sesion.idEstado = 2;
            await queryRunner.manager.save(sesion);

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
