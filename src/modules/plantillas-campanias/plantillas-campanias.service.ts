import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlantillaCampania } from './entities/plantilla-campania.entity';
import { CreatePlantillaCampaniaDto } from './dto/create-plantilla-campania.dto';
import { UpdatePlantillaCampaniaDto } from './dto/update-plantilla-campania.dto';

@Injectable()
export class PlantillasCampaniasService {
    constructor(
        @InjectRepository(PlantillaCampania)
        private readonly plantillaRepo: Repository<PlantillaCampania>,
    ) { }

    async crear(dto: CreatePlantillaCampaniaDto): Promise<PlantillaCampania> {
        const plantilla = this.plantillaRepo.create(dto);
        return await this.plantillaRepo.save(plantilla);
    }

    async obtenerTodas(codigoEmpresa: number): Promise<PlantillaCampania[]> {
        return await this.plantillaRepo.find({
            where: { codigo_empresa: codigoEmpresa },
            order: { created_at: 'DESC' },
        });
    }

    async obtenerPorId(id: number): Promise<PlantillaCampania> {
        const plantilla = await this.plantillaRepo.findOne({ where: { id } });
        if (!plantilla) {
            throw new NotFoundException(`Plantilla de campaña con ID ${id} no encontrada`);
        }
        return plantilla;
    }

    async actualizar(
        id: number,
        dto: UpdatePlantillaCampaniaDto,
    ): Promise<PlantillaCampania> {
        await this.plantillaRepo.update(id, dto);
        return this.obtenerPorId(id);
    }

    async eliminar(id: number): Promise<void> {
        const result = await this.plantillaRepo.delete(id);
        if (result.affected === 0) {
            throw new NotFoundException(`Plantilla de campaña con ID ${id} no encontrada`);
        }
    }

    // Método para obtener plantillas pendientes de aprobación en Meta
    async obtenerPendientes(): Promise<PlantillaCampania[]> {
        return await this.plantillaRepo.find({
            where: { metaStatus: 'PENDING' },
        });
    }

    // Método para obtener plantillas por estados específicos
    async obtenerPorEstados(estados: string[]): Promise<PlantillaCampania[]> {
        return await this.plantillaRepo.createQueryBuilder('plantilla')
            .where('plantilla.metaStatus IN (:...estados)', { estados })
            .getMany();
    }

    // Método para actualizar estado de Meta
    async actualizarEstadoMeta(
        id: number,
        metaStatus: string,
        metaTemplateId?: string,
        metaError?: string,
    ): Promise<void> {
        await this.plantillaRepo.update(id, {
            metaStatus,
            metaTemplateId,
            metaSyncedAt: new Date(),
            metaError,
        });
    }
}
