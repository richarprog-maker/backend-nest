import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HistorialEnvio } from '../entities/historial-envio.entity';

@Injectable()
export class HistorialEnviosService {
    private readonly logger = new Logger(HistorialEnviosService.name);

    constructor(
        @InjectRepository(HistorialEnvio)
        private historialRepo: Repository<HistorialEnvio>,
    ) { }

    async registrarEnvio(
        leadId: number,
        tipoMensaje: string,
        plantillaId: number | null,
        estado: string = 'ENVIADO',
        metadata: any = {}
    ): Promise<HistorialEnvio> {
        try {
            const nuevoEnvio = this.historialRepo.create({
                leadId,
                plantillaId,
                tipoMensaje,
                fechaEnvio: new Date(),
                estado,
                metadata
            });
            return await this.historialRepo.save(nuevoEnvio);
        } catch (error) {
            this.logger.error(`Error registrando envio para lead ${leadId}: ${error.message}`);
            return null;
        }
    }

    async haRecibidoMensaje(leadId: number, tipoMensaje: string): Promise<boolean> {
        const count = await this.historialRepo.count({
            where: { leadId, tipoMensaje, estado: 'ENVIADO' }
        });
        return count > 0;
    }
}
