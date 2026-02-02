import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';
import { HistorialClasificacionLead } from '../../clasificacion-leads/entities/historial-clasificacion-lead.entity';
import { TimeUtils } from '../../../common/utils/time.utils';

/**
 * Servicio que clasifica automáticamente como "bajo" (frío) a los leads
 * que completaron el ciclo de recuperación (3 plantillas) sin responder
 */
@Injectable()
export class ClasificacionFrioTasksService {
    private readonly logger = new Logger(ClasificacionFrioTasksService.name);

    constructor(
        @InjectRepository(SesionConversacion)
        private sesionRepo: Repository<SesionConversacion>,
        @InjectRepository(HistorialClasificacionLead)
        private clasificacionRepo: Repository<HistorialClasificacionLead>,
        private dataSource: DataSource,
    ) { }

    /**
     * Cron que se ejecuta cada 5 minutos para clasificar leads fríos
     */
    @Cron(CronExpression.EVERY_MINUTE)
    async clasificarLeadsFrios() {
        // Validación de horario operativo
        if (!TimeUtils.isWithinOperatingHours()) {
            this.logger.debug('Fuera de horario operativo. Cron pausado.');
            return;
        }

        this.logger.log('🧊 Verificando leads fríos para clasificar...');

        try {
            // Buscar sesiones que cumplan las condiciones:
            // - proximo_mensaje_minutos = 0 (ciclo de recuperación completo)
            // - id_estado = 1 (activo, no procesado)
            const sesiones = await this.sesionRepo.find({
                where: {
                    proximoMensajeMinutos: 0,
                    idEstado: 1,
                }
            });

            if (sesiones.length === 0) {
                this.logger.debug('No hay leads fríos para clasificar.');
                return;
            }

            this.logger.log(`Encontrados ${sesiones.length} leads fríos para clasificar.`);

            // Procesar cada sesión
            for (const sesion of sesiones) {
                await this.clasificarComoFrio(sesion);
            }

            this.logger.log(`✅ Clasificación completada: ${sesiones.length} leads procesados.`);

        } catch (error) {
            this.logger.error('❌ Error en cron de clasificación de leads fríos', error);
        }
    }

    /**
     * Clasifica una sesión como "bajo" e inserta el registro de clasificación
     */
    private async clasificarComoFrio(sesion: SesionConversacion) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // 1. Insertar clasificación en historial
            const nuevaClasificacion = this.clasificacionRepo.create({
                idSesion: sesion.id,
                clasificacion: 'bajo',
                razon: 'Se enviaron 3 plantillas de recuperación sin respuesta',
            });

            await queryRunner.manager.save(nuevaClasificacion);

            // 2. Actualizar estado de la sesión a 2 (procesado/cerrado)
            sesion.idEstado = 2;
            await queryRunner.manager.save(sesion);

            await queryRunner.commitTransaction();

            this.logger.log(`Lead clasificado como BAJO - Sesión ID: ${sesion.id}, Lead UUID: ${sesion.leadUuid}`);

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`Error clasificando sesión ${sesion.id}:`, error);
        } finally {
            await queryRunner.release();
        }
    }
}
