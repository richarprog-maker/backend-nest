import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campania } from './entities/campania.entity';

@Injectable()
export class CampaniasService {
    private readonly logger = new Logger(CampaniasService.name);

    constructor(
        @InjectRepository(Campania)
        private campaniaRepo: Repository<Campania>,
    ) { }

    async crear(data: Partial<Campania>) {
        const nuevaCampania = this.campaniaRepo.create(data);
        return this.campaniaRepo.save(nuevaCampania);
    }

    async listar(codigoEmpresa: number) {
        return this.campaniaRepo.find({
            where: { codigoEmpresa },
            order: { fechaRegistro: 'DESC' }
        });
    }

    async obtenerPorId(id: number) {
        return this.campaniaRepo.findOneBy({ id });
    }

    // TODO: Agregar lógica de envío o integración con Worker
}
