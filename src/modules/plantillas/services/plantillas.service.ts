import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlantillaMensaje, TipoPlantilla } from '../entities/plantilla.entity';

@Injectable()
export class PlantillasService {
    constructor(
        @InjectRepository(PlantillaMensaje)
        private plantillaRepo: Repository<PlantillaMensaje>,
    ) { }

    // Metodos dinámicos para gestión de plantillas
    async crear(plantilla: PlantillaMensaje): Promise<PlantillaMensaje> {
        return this.plantillaRepo.save(plantilla);
    }

    async obtenerPlantillaPorTipo(tipo: TipoPlantilla, codigoEmpresa: number = 1): Promise<PlantillaMensaje> {
        return this.plantillaRepo.findOne({ where: { tipo, codigoEmpresa } });
    }

    async obtenerPlantillaPorNombre(nombre: string): Promise<PlantillaMensaje> {
        return this.plantillaRepo.findOne({ where: { nombre } });
    }

    async obtenerTodas(codigoEmpresa: number = 1): Promise<PlantillaMensaje[]> {
        return this.plantillaRepo.find({ where: { codigoEmpresa } });
    }
}
