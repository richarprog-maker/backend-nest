import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxService } from './inbox.service';
import { Lead } from './entities/lead.entity';
import { Prospecto } from './entities/prospecto.entity';
import { Mensaje } from './entities/mensaje.entity';
import { InboxController } from './inbox.controller';
import { CredencialesWapi } from '../webhook_meta/entities/credenciales-wapi.entity';
import { WapiService } from '../webhook_meta/wapi.service';
import { ConfigModule } from '@nestjs/config';
import { InboxGateway } from './inbox.gateway';
import { AiModule } from '../ia/ia.module';

@Module({
    imports: [
        ConfigModule,
        TypeOrmModule.forFeature([Lead, Prospecto, Mensaje, CredencialesWapi]),
        forwardRef(() => AiModule)
    ],
    controllers: [InboxController],
    providers: [InboxService, WapiService, InboxGateway],
    exports: [InboxService, InboxGateway, TypeOrmModule],
})
export class InboxModule { }
