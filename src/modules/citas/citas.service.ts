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

    /**
     * Verifica si existe una cita en el horario especificado
     * @param excludeLeadUuid - UUID del lead a excluir de la validación (útil para reagendamiento)
     */
    async existeCitaEnHorario(fecha: string, hora: string, codigoEmpresa: number, excludeLeadUuid?: string): Promise<boolean> {
        const query = this.citaRepo.createQueryBuilder('cita')
            .where('cita.fechaCita = :fecha', { fecha })
            .andWhere('cita.horaCita = :hora', { hora })
            .andWhere('cita.codigoEmpresa = :codigoEmpresa', { codigoEmpresa })
            .andWhere('cita.estadoCita IN (:...estados)', { estados: ['pendiente', 'confirmada'] });

        // Excluir citas del mismo lead si se especifica
        if (excludeLeadUuid) {
            query.andWhere('cita.leadUuid != :leadUuid', { leadUuid: excludeLeadUuid });
        }

        const count = await query.getCount();
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

    /**
     * Reagenda una cita existente (cambia fecha, hora o tipo)
     */
    async reagendarCita(idCita: number, data: {
        fechaCita?: string;
        horaCita?: string;
        tipoCita?: string;
        observacion?: string;
    }) {
        this.logger.log(`Reagendando cita ${idCita} con: ${JSON.stringify(data)}`);
        return this.citaRepo.update(idCita, {
            ...data,
            fechaActualizacion: new Date()
        });
    }
}
