import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bot } from './entities/bot.entity';

@Injectable()
export class BotsService {
    private readonly logger = new Logger(BotsService.name);

    constructor(
        @InjectRepository(Bot)
        private botRepo: Repository<Bot>,
    ) { }

    async getBotsPorEmpresa(codigoEmpresa: number) {
        try {
            const bots = await this.botRepo.find({
                where: { codigoEmpresa }
            });

            return { Status: 'Success', data: bots };
        } catch (error) {
            this.logger.error(`Error obteniendo bots empresa ${codigoEmpresa}: ${error.message}`);
            return { Status: 'Error', message: 'Error interno obteniendo bots' };
        }
    }
}
