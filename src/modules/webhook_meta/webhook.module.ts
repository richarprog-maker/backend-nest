import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { ConfigModule } from '@nestjs/config';
import { CredencialesWapi } from './entities/credenciales-wapi.entity';
import { Mensaje } from '../inbox/entities/mensaje.entity';
import { Lead } from '../inbox/entities/lead.entity';
import { Prospecto } from '../inbox/entities/prospecto.entity';
import { AiModule } from '../ia/ia.module';
import { WapiService } from './wapi.service';
import { SmartSplitService } from '../ia/smart-split.service';
import { InboxModule } from '../inbox/inbox.module';

@Module({
    imports: [
        ConfigModule,
        AiModule,
        forwardRef(() => InboxModule),
        TypeOrmModule.forFeature([CredencialesWapi, Mensaje, Lead, Prospecto])
    ],
    controllers: [WebhookController],
    providers: [WebhookService, WapiService, SmartSplitService],
    exports: [WapiService], // Exportar para que otros módulos puedan usarlo
})
export class WebhookModule { }
