import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProspectosController } from './prospectos.controller';
import { ServicioExcel } from './services/excel.service';
import { OrquestadorImportacionService } from './services/orquestador-importacion.service';
import { ProspectosService } from './services/prospectos.service';
import { Lead } from '../inbox/entities/lead.entity';
import { Prospecto } from '../inbox/entities/prospecto.entity';
import { ContextoLead } from '../ia/entities/contexto-lead.entity';
import { OrigenDato } from '../inbox/entities/origen-dato.entity';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { PlantillasModule } from '../plantillas/plantillas.module';
import { HistorialEnviosModule } from '../historial-envios/historial-envios.module';
import { WebhookModule } from '../webhook_meta/webhook.module';

import { Mensaje } from '../inbox/entities/mensaje.entity';
import { HistorialChatAi } from '../ia/entities/historial-chat-ai.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Lead,
            Prospecto,
            ContextoLead,
            OrigenDato,
            SesionConversacion,
            Mensaje,
            HistorialChatAi
        ]),
        PlantillasModule,
        HistorialEnviosModule,
        WebhookModule
    ],
    controllers: [ProspectosController],
    providers: [ServicioExcel, OrquestadorImportacionService, ProspectosService],
    exports: [OrquestadorImportacionService, ProspectosService]
})
export class ProspectosModule { }
