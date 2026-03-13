import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
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
        nombreProyecto?: string | null,
    ): Promise<Proyecto | null> {
        if (proyectoIdSperant) {
            const proyectoPorId = await this.proyectoRepo.findOne({
                where: {
                    codigoEmpresa,
                    sperantProjectId: proyectoIdSperant,
                    estado: 'activo',
                },
            });

            if (proyectoPorId) {
                return proyectoPorId;
            }
        }

        if (!nombreProyecto?.trim()) {
            return null;
        }

        const nombreLimpio = nombreProyecto.trim();
        const candidatos = await this.proyectoRepo.find({
            where: [
                { codigoEmpresa, estado: 'activo', nombre: ILike(nombreLimpio) },
                { codigoEmpresa, estado: 'activo', nombre: ILike(`%${nombreLimpio}%`) },
            ],
            order: { id: 'ASC' },
        });

        const proyecto = candidatos.find((item) => this.normalizar(item.nombre) === this.normalizar(nombreLimpio))
            || candidatos[0]
            || null;

        if (proyecto && proyectoIdSperant && !proyecto.sperantProjectId) {
            proyecto.sperantProjectId = proyectoIdSperant;
            await this.proyectoRepo.save(proyecto);
            this.logger.log(
                `[Sperant][Proyecto] Vinculado proyecto local ${proyecto.id} (${proyecto.nombre}) con SPERANT ${proyectoIdSperant}`,
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

    private normalizar(valor: string): string {
        return (valor || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
