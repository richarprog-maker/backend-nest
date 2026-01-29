import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProspectosController } from './prospectos.controller';
import { ServicioExcel } from './services/excel.service';
import { OrquestadorImportacionService } from './services/orquestador-importacion.service';
import { Lead } from '../inbox/entities/lead.entity';
import { Prospecto } from '../inbox/entities/prospecto.entity';
import { OrigenDato } from '../inbox/entities/origen-dato.entity';
import { ContextoLead } from '../ia/entities/contexto-lead.entity';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { InboxModule } from '../inbox/inbox.module';

import { ProspectosService } from './services/prospectos.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([Lead, Prospecto, OrigenDato, ContextoLead, SesionConversacion]),
        InboxModule
    ],
    controllers: [ProspectosController],
    providers: [ServicioExcel, OrquestadorImportacionService, ProspectosService],
    exports: [OrquestadorImportacionService, ProspectosService]
})
export class ProspectosModule { }
