
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { RecoveryTasksService } from './services/recovery-tasks.service';
import { RecordatorioCitasService } from './services/recordatorio-citas.service';
import { ClasificacionFrioTasksService } from './services/clasificacion-frio-tasks.service';
import { ClasificacionTibioTasksService } from './services/clasificacion-medio-alto-tasks.service';
import { CampaniasProgramadasService } from './services/campanias-programadas.service';
import { PlantillasStatusService } from './services/plantillas-status.service';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { PlantillaMensaje } from '../plantillas/entities/plantilla.entity';
import { HistorialPlantillas } from '../plantillas/entities/historial-plantilla.entity';
import { HistorialClasificacionLead } from '../clasificacion-leads/entities/historial-clasificacion-lead.entity';
import { WebhookModule } from '../webhook_meta/webhook.module';
import { Lead } from '../inbox/entities/lead.entity';
import { Mensaje } from '../inbox/entities/mensaje.entity';
import { HistorialChatAi } from '../ia/entities/historial-chat-ai.entity';
import { InboxModule } from '../inbox/inbox.module';
import { Cita } from '../citas/entities/cita.entity';
import { CampaniaProgramada } from '../campanias/entities/campania-programada.entity';
import { Campania } from '../campanias/entities/campania.entity';
import { PlantillasModule } from '../plantillas/plantillas.module';
import { PlantillasCampaniasModule } from '../plantillas-campanias/plantillas-campanias.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([
            SesionConversacion,
            PlantillaMensaje,
            Lead,
            HistorialPlantillas,
            Mensaje,
            HistorialChatAi,
            Cita,
            HistorialClasificacionLead,
            CampaniaProgramada,
            Campania
        ]),
        BullModule.registerQueue({
            name: 'campanias',
        }),
        WebhookModule,
        InboxModule,
        PlantillasModule,
        PlantillasCampaniasModule
    ],
    providers: [
        RecoveryTasksService,
        RecordatorioCitasService,
        ClasificacionFrioTasksService,
        ClasificacionTibioTasksService,
        CampaniasProgramadasService,
        PlantillasStatusService
    ],
    exports: [CampaniasProgramadasService],
})
export class TasksModule { }
