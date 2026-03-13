import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { COLA_SPERANT, TRABAJO_PROCESAR_WEBHOOK_SPERANT } from '../services/constantes-sperant';
import { ServicioSperantService } from '../services/servicio-sperant.service';

@Processor(COLA_SPERANT, { concurrency: 5 })
export class SperantProcessor extends WorkerHost {
    private readonly logger = new Logger(SperantProcessor.name);

    constructor(private readonly servicioSperant: ServicioSperantService) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        if (job.name === TRABAJO_PROCESAR_WEBHOOK_SPERANT) {
            await this.servicioSperant.procesarEventoWebhook(job.data.eventoId);
            return;
        }

        this.logger.warn(`[Sperant][Queue] Trabajo desconocido ${job.name}`);
    }
}
