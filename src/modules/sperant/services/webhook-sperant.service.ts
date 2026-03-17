import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { RecibirWebhookSperantDto } from '../dto/recibir-webhook-sperant.dto';
import { EventoWebhookSperant } from '../entities/evento-webhook-sperant.entity';
import { COLA_SPERANT, TRABAJO_PROCESAR_WEBHOOK_SPERANT } from './constantes-sperant';

@Injectable()
export class WebhookSperantService {
    private readonly logger = new Logger(WebhookSperantService.name);

    constructor(
        @InjectRepository(EventoWebhookSperant)
        private readonly eventoWebhookRepo: Repository<EventoWebhookSperant>,
        @InjectQueue(COLA_SPERANT)
        private readonly colaSperant: Queue,
    ) { }

    async registrarWebhook(
        codigoEmpresa: number,
        body: RecibirWebhookSperantDto,
        headers: Record<string, string | string[] | undefined>,
    ) {
        const correlationIdHeader = headers['x-correlation-id'] || headers['x-request-id'];
        const correlationId = Array.isArray(correlationIdHeader)
            ? correlationIdHeader[0]
            : String(correlationIdHeader || randomUUID());
        const llaveIdempotencia = this.generarLlaveIdempotencia(codigoEmpresa, body);

        let evento = await this.eventoWebhookRepo.findOne({
            where: {
                codigoEmpresa,
                llaveIdempotencia,
            },
        });

        if (!evento) {
            evento = await this.eventoWebhookRepo.save(this.eventoWebhookRepo.create({
                codigoEmpresa,
                tipoEvento: body.event_name,
                clienteIdSperant: Number(body.client?.id || 0) || null,
                llaveIdempotencia,
                correlationId,
                payload: body,
                estado: 'pendiente',
            }));
        }

        if (evento.estado !== 'procesado') {
            try {
                await this.colaSperant.add(
                    TRABAJO_PROCESAR_WEBHOOK_SPERANT,
                    { eventoId: evento.id },
                    {
                        jobId: llaveIdempotencia,
                        attempts: 5,
                        backoff: {
                            type: 'exponential',
                            delay: 3000,
                        },
                        removeOnComplete: true,
                        removeOnFail: false,
                    },
                );
            } catch (error) {
                const mensaje = error instanceof Error ? error.message : '';
                if (!mensaje.includes('Job is already waiting') && !mensaje.includes('Job is already active')) {
                    throw error;
                }
            }
        }

        this.logger.log(
            `[Sperant][Webhook] Recibido ${body.event_name} cliente=${body.client?.id} correlation=${correlationId}`,
        );

        return {
            status: 'ok',
            correlation_id: correlationId,
            evento_id: evento.id,
        };
    }

    private generarLlaveIdempotencia(codigoEmpresa: number, body: RecibirWebhookSperantDto): string {
        const bruto = [
            codigoEmpresa,
            body.event_name,
            body.client?.id || '',
            body.client?.created_at || '',
            body.client?.last_interaction_at || '',
        ].join(':');

        return createHash('sha256').update(bruto).digest('hex');
    }
}
