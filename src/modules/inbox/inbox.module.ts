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
import { VendedorProyecto } from '../proyectos/entities/asesor-proyecto.entity';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';

@Module({
    imports: [
        ConfigModule,
        TypeOrmModule.forFeature([Lead, Prospecto, Mensaje, CredencialesWapi, VendedorProyecto, SesionConversacion]),
        forwardRef(() => AiModule)
    ],
    controllers: [InboxController],
    providers: [InboxService, WapiService, InboxGateway],
    exports: [InboxService, InboxGateway, TypeOrmModule],
})
export class InboxModule { }
