import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cita } from './entities/cita.entity';

@Injectable()
export class CitasService {
    private readonly logger = new Logger(CitasService.name);

    constructor(
        @InjectRepository(Cita)
        private citaRepo: Repository<Cita>,
    ) { }

    async crearCita(data: Partial<Cita>) {
        const nuevaCita = this.citaRepo.create(data);
        return this.citaRepo.save(nuevaCita);
    }

    async existeCitaEnHorario(fecha: string, hora: string, codigoEmpresa: number): Promise<boolean> {
        const count = await this.citaRepo.count({
            where: {
                fechaCita: fecha,
                horaCita: hora,
                codigoEmpresa,
                estadoCita: 'pendiente' // Solo validamos contra pendientes o confirmadas, no canceladas
            }
        });
        return count > 0;
    }

    async cancelarCita(id: number) {
        return this.citaRepo.update(id, { estadoCita: 'cancelada' });
    }

    async listarCitas(codigoEmpresa: number) {
        return this.citaRepo.find({
            where: { codigoEmpresa },
            order: { fechaCita: 'DESC', horaCita: 'ASC' }
        });
    }

    async obtenerUltimaCitaPorLead(leadUuid: string, codigoEmpresa: number): Promise<Cita | null> {
        return this.citaRepo.findOne({
            where: {
                leadUuid,
                codigoEmpresa
            },
            order: {
                fechaCita: 'DESC',
                horaCita: 'DESC',
                id: 'DESC' // Asegurar orden estable en caso de empate
            }
        });
    }
}
