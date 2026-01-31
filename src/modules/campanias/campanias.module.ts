import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Campania } from './entities/campania.entity';
import { CampaniaDetalle } from './entities/campania-detalle.entity';
import { CampaniasService } from './campanias.service';
import { CampaniasController } from './campanias.controller';
import { CampaniasProcessor } from './campanias.processor';
import { WebhookModule } from '../webhook_meta/webhook.module'; // Para acceder a WapiService

@Module({
    imports: [
        TypeOrmModule.forFeature([Campania, CampaniaDetalle]),
        BullModule.registerQueue({
            name: 'campanias',
        }),
        WebhookModule,
    ],
    controllers: [CampaniasController],
    providers: [CampaniasService, CampaniasProcessor],
    exports: [CampaniasService],
})
export class CampaniasModule { }
