import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Proyecto } from '../../proyectos/entities/proyecto.entity';

@Injectable()
export class ServicioProyectosSperantService {
    private readonly logger = new Logger(ServicioProyectosSperantService.name);

    constructor(
        @InjectRepository(Proyecto)
        private readonly proyectoRepo: Repository<Proyecto>,
    ) { }

    async resolverProyectoLocal(
        codigoEmpresa: number,
        proyectoIdSperant?: number | null,
    ): Promise<Proyecto | null> {
        if (!proyectoIdSperant) {
            return null;
        }

        const proyecto = await this.proyectoRepo.findOne({
            where: {
                codigoEmpresa,
                sperantProjectId: proyectoIdSperant,
                estado: 'activo',
            },
        });

        if (!proyecto) {
            this.logger.warn(
                `[Sperant][Proyecto] No existe mapeo local para project_id=${proyectoIdSperant} en empresa ${codigoEmpresa}`,
            );
        }

        return proyecto;
    }

    async obtenerProyectoSperantDesdeLocal(proyectoIdLocal: number, codigoEmpresa: number): Promise<Proyecto | null> {
        if (!proyectoIdLocal) {
            return null;
        }

        return this.proyectoRepo.findOne({
            where: {
                id: proyectoIdLocal,
                codigoEmpresa,
                estado: 'activo',
            },
        });
    }
}
