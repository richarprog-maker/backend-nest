import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PlantillasCampaniasService } from '../../plantillas-campanias/plantillas-campanias.service';
import { MetaTemplatesService } from '../../plantillas-campanias/services/meta-templates.service';
import { Campania, EstadoCampania } from '../../campanias/entities/campania.entity';
import { CampaniaProgramada, EstadoCampaniaProgramada } from '../../campanias/entities/campania-programada.entity';

@Injectable()
export class PlantillasStatusService {
    private readonly logger = new Logger(PlantillasStatusService.name);

    constructor(
        private readonly plantillasCampaniasService: PlantillasCampaniasService,
        private readonly metaTemplatesService: MetaTemplatesService,
        @InjectRepository(Campania)
        private readonly campaniaRepo: Repository<Campania>,
        @InjectRepository(CampaniaProgramada)
        private readonly programadaRepo: Repository<CampaniaProgramada>,
        @InjectQueue('campanias') private campaniasQueue: Queue,
    ) { }

    @Cron(CronExpression.EVERY_MINUTE)
    async verificarEstadoPlantillas() {
        this.logger.log('Iniciando verificación de estado de plantillas en Meta...');

        try {
            const plantillasPendientes = await this.plantillasCampaniasService.obtenerPorEstados(['PENDING', 'LOCAL']);

            if (plantillasPendientes.length === 0) {
                this.logger.debug('No hay plantillas pendientes de verificación');
                return;
            }

            this.logger.log(`Verificando ${plantillasPendientes.length} plantillas (PENDING/LOCAL)...`);

            const porEmpresa = plantillasPendientes.reduce((acc, p) => {
                const empresa = p.codigo_empresa || 1;
                if (!acc[empresa]) acc[empresa] = [];
                acc[empresa].push(p);
                return acc;
            }, {} as Record<number, any[]>);

            for (const [codigoEmpresa, plantillas] of Object.entries(porEmpresa)) {
                try {
                    const plantillasMeta = await this.metaTemplatesService.listarPlantillasMeta(
                        parseInt(codigoEmpresa)
                    );

                    if (!plantillasMeta || plantillasMeta.length === 0) {
                        this.logger.warn(`No se encontraron plantillas en Meta para empresa ${codigoEmpresa}`);
                        continue;
                    }

                    const metaPorId = new Map(plantillasMeta.map(pm => [pm.id, pm]));
                    const metaPorNombre = new Map(plantillasMeta.map(pm => [pm.name, pm]));

                    for (const plantillaLocal of plantillas) {
                        let plantillaMeta = null;

                        if (plantillaLocal.metaTemplateId) {
                            plantillaMeta = metaPorId.get(plantillaLocal.metaTemplateId);
                        }

                        if (!plantillaMeta && plantillaLocal.metaStatus === 'LOCAL') {
                            const nombreNormalizado = this.normalizeName(plantillaLocal.nombre);
                            plantillaMeta = metaPorNombre.get(nombreNormalizado);

                            if (plantillaMeta) {
                                this.logger.log(`¡Match por nombre encontrado! Vinculando "${plantillaLocal.nombre}" con ID Meta ${plantillaMeta.id}`);
                            }
                        }

                        if (plantillaMeta) {
                            const nuevoEstado = this.mapearEstadoMeta(plantillaMeta.status);
                            const reasons = plantillaMeta.quality_score?.reasons?.join(', ') || null;
                            const estadoAnterior = plantillaLocal.metaStatus;

                            if (
                                nuevoEstado !== plantillaLocal.metaStatus ||
                                plantillaMeta.id !== plantillaLocal.metaTemplateId ||
                                reasons !== (plantillaLocal as any).metaError
                            ) {
                                await this.plantillasCampaniasService.actualizarEstadoMeta(
                                    plantillaLocal.id,
                                    nuevoEstado,
                                    plantillaMeta.id,
                                    reasons
                                );

                                this.logger.log(
                                    `Plantilla "${plantillaLocal.nombre}" actualizada: ${estadoAnterior} -> ${nuevoEstado} (ID: ${plantillaMeta.id})`
                                );

                                if (nuevoEstado === 'APPROVED' && estadoAnterior !== 'APPROVED') {
                                    await this.dispararCampaniasProgramadas(plantillaLocal.id);
                                }
                            }
                        } else if (plantillaLocal.metaStatus === 'PENDING') {
                            if (plantillaLocal.metaTemplateId) {
                                await this.plantillasCampaniasService.actualizarEstadoMeta(
                                    plantillaLocal.id,
                                    'REJECTED',
                                    plantillaLocal.metaTemplateId,
                                    'Plantilla no encontrada en Meta API (posiblemente eliminada)'
                                );
                            }
                        }
                    }
                } catch (error) {
                    this.logger.error(
                        `Error verificando plantillas empresa ${codigoEmpresa}: ${error.message}`
                    );
                }
            }

        } catch (error) {
            this.logger.error(`Error en verificación de plantillas: ${error.message}`);
        }
    }

    private normalizeName(nombre: string): string {
        return nombre
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .substring(0, 512);
    }

    private mapearEstadoMeta(estadoMeta: string): string {
        const mapa: Record<string, string> = {
            'APPROVED': 'APPROVED',
            'PENDING': 'PENDING',
            'REJECTED': 'REJECTED',
            'IN_APPEAL': 'PENDING',
            'PENDING_DELETION': 'REJECTED',
            'DISABLED': 'REJECTED',
            'PAUSED': 'REJECTED'
        };
        return mapa[estadoMeta] || 'PENDING';
    }

    /**
     * Dispara automáticamente las campañas programadas que usen esta plantilla
     * cuando la plantilla es aprobada por Meta
     */
    private async dispararCampaniasProgramadas(plantillaId: number): Promise<void> {
        try {
            // Buscar campañas en estado PROGRAMADO que usen esta plantilla
            const campaniasPendientes = await this.campaniaRepo.find({
                where: {
                    plantillaId: plantillaId,
                    estado: EstadoCampania.PROGRAMADO
                }
            });

            if (campaniasPendientes.length === 0) {
                this.logger.debug(`No hay campañas programadas esperando la plantilla ID ${plantillaId}`);
                return;
            }

            this.logger.log(`🚀 Plantilla aprobada! Disparando ${campaniasPendientes.length} campañas programadas...`);

            for (const campania of campaniasPendientes) {
                try {
                    // Buscar el registro de programación correspondiente
                    const programada = await this.programadaRepo.findOne({
                        where: {
                            campaniaId: campania.id,
                            estado: EstadoCampaniaProgramada.PENDIENTE
                        }
                    });

                    if (!programada) {
                        this.logger.warn(`Campaña ${campania.id} en estado PROGRAMADO pero sin registro en tbl_campanias_programadas`);
                        continue;
                    }

                    // Actualizar a procesando
                    await this.programadaRepo.update(programada.id, {
                        estado: EstadoCampaniaProgramada.PROCESANDO,
                        fechaEjecucion: new Date()
                    });

                    // Encolar para procesamiento inmediato
                    await this.campaniasQueue.add('procesar-audiencia', {
                        campaniaId: campania.id,
                        codigoEmpresa: campania.codigoEmpresa,
                        esProgramada: true,
                        programadaId: programada.id
                    }, {
                        removeOnComplete: true
                    });

                    this.logger.log(`✅ Campaña #${campania.id} "${campania.nombre}" encolada para envío inmediato`);

                } catch (error) {
                    this.logger.error(`Error al disparar campaña ${campania.id}: ${error.message}`);
                }
            }

        } catch (error) {
            this.logger.error(`Error al buscar campañas programadas para plantilla ${plantillaId}: ${error.message}`);
        }
    }
}
