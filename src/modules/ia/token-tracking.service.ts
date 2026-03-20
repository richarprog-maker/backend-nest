import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IaTokenLog } from './entities/ia-token-log.entity';

type TokenPhase = 'main_chat' | 'summary_extract' | 'faq_llm' | 'lead_scoring';

@Injectable()
export class TokenTrackingService {
    private readonly logger = new Logger(TokenTrackingService.name);

    constructor(
        @InjectRepository(IaTokenLog)
        private tokenLogRepo: Repository<IaTokenLog>,
    ) { }

    async registrar(data: {
        leadUuid?: string;
        codigoEmpresa?: number;
        fase: TokenPhase;
        modelo: string;
        inputTokens: number;
        outputTokens: number;
        metadatos?: any;
    }): Promise<void> {
        if (!data.inputTokens && !data.outputTokens) {
            return;
        }

        try {
            const record = this.tokenLogRepo.create({
                leadUuid: data.leadUuid,
                codigoEmpresa: data.codigoEmpresa,
                fase: data.fase,
                nombreModelo: data.modelo,
                tknInput: data.inputTokens,
                tknOutput: data.outputTokens,
                metadatos: data.metadatos || null,
            });

            await this.tokenLogRepo.save(record);
        } catch (error) {
            this.logger.warn(`No se pudo registrar token log (${data.fase}): ${error.message}`);
        }
    }
}
