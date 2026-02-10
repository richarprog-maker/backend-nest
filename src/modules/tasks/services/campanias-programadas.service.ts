import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CampaniaProgramada, EstadoCampaniaProgramada } from '../../campanias/entities/campania-programada.entity';
import { Campania } from '../../campanias/entities/campania.entity';
import { PlantillaMensaje } from '../../plantillas/entities/plantilla.entity';

@Injectable()
export class CampaniasProgramadasService {
    private readonly logger = new Logger(CampaniasProgramadasService.name);

    constructor(
        @InjectRepository(CampaniaProgramada)
        private programadaRepo: Repository<CampaniaProgramada>,
        @InjectRepository(Campania)
        private campaniaRepo: Repository<Campania>,
        @InjectRepository(PlantillaMensaje)
        private plantillaRepo: Repository<PlantillaMensaje>,
        @InjectQueue('campanias') private campaniasQueue: Queue
    ) { }

    @Cron(CronExpression.EVERY_MINUTE)
    async verificarCampaniasProgramadas() {
        const ahora = new Date();

        try {
            const campaniasPendientes = await this.programadaRepo.find({
                where: {
                    estado: EstadoCampaniaProgramada.PENDIENTE,
                    fechaProgramada: LessThanOrEqual(ahora)
                },
                relations: ['campania']
            });

            if (campaniasPendientes.length === 0) {
                return;
            }

            this.logger.log(`Encontradas ${campaniasPendientes.length} campañas programadas para ejecutar`);

            for (const programada of campaniasPendientes) {
                await this.ejecutarCampaniaProgramada(programada);
            }

        } catch (error) {
            this.logger.error(`Error verificando campañas programadas: ${error.message}`);
        }
    }

    private async ejecutarCampaniaProgramada(programada: CampaniaProgramada) {
        try {
            const campania = await this.campaniaRepo.findOne({
                where: { id: programada.campaniaId },
                relations: ['plantilla']
            });

            if (!campania) {
                await this.marcarFallido(programada.id, 'Campaña no encontrada');
                return;
            }

            if (campania.estado === 'pausado') {
                this.logger.debug(`Campaña ${campania.id} está PAUSADA. No se ejecutará hasta que se reactive.`);
                return;
            }

            if (campania.plantilla?.metaStatus !== 'APPROVED') {
                if (campania.plantilla?.metaStatus === 'REJECTED' || campania.plantilla?.metaStatus === 'PAUSED' || campania.plantilla?.metaStatus === 'DISABLED') {
                    await this.marcarFallido(
                        programada.id,
                        `Plantilla rechazada o deshabilitada. Estado: ${campania.plantilla?.metaStatus}`
                    );
                } else {
                   
                    this.logger.debug(`Campaña ${campania.id} esperando aprobación de plantilla. Estado actual: ${campania.plantilla?.metaStatus || 'LOCAL'}`);
                }
                return;
            }

            await this.programadaRepo.update(programada.id, {
                estado: EstadoCampaniaProgramada.PROCESANDO,
                fechaEjecucion: new Date()
            });
            await this.campaniasQueue.add('procesar-audiencia', {
                campaniaId: campania.id,
                codigoEmpresa: campania.codigoEmpresa,
                esProgramada: true,
                programadaId: programada.id
            }, {
                removeOnComplete: true
            });

            this.logger.log(`Campaña programada #${programada.id} encolada para ejecución`);

        } catch (error) {
            this.logger.error(`Error ejecutando campaña programada #${programada.id}: ${error.message}`);
            await this.marcarFallido(programada.id, error.message);
        }
    }

    private async marcarFallido(id: number, error: string) {
        await this.programadaRepo.update(id, {
            estado: EstadoCampaniaProgramada.FALLIDO,
            errorLog: error
        });
    }

    async marcarCompletado(id: number) {
        await this.programadaRepo.update(id, {
            estado: EstadoCampaniaProgramada.COMPLETADO
        });
    }

    async programarCampania(
        campaniaId: number,
        fechaProgramada: Date,
        codigoEmpresa: number
    ): Promise<CampaniaProgramada> {
        const programada = this.programadaRepo.create({
            campaniaId,
            fechaProgramada,
            codigoEmpresa,
            estado: EstadoCampaniaProgramada.PENDIENTE
        });

        return this.programadaRepo.save(programada);
    }

    async cancelarProgramacion(id: number) {
        await this.programadaRepo.update(id, {
            estado: EstadoCampaniaProgramada.CANCELADO
        });
    }
}
