
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecoveryTasksService } from './services/recovery-tasks.service';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { PlantillaMensaje } from '../plantillas/entities/plantilla.entity';
import { HistorialPlantillas } from '../plantillas/entities/historial-plantilla.entity';
import { WebhookModule } from '../webhook_meta/webhook.module';
import { Lead } from '../inbox/entities/lead.entity';
import { Mensaje } from '../inbox/entities/mensaje.entity';
import { HistorialChatAi } from '../ia/entities/historial-chat-ai.entity';
import { InboxModule } from '../inbox/inbox.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([SesionConversacion, PlantillaMensaje, Lead, HistorialPlantillas, Mensaje, HistorialChatAi]),
        WebhookModule,
        InboxModule,
    ],
    providers: [RecoveryTasksService],
})
export class TasksModule { }
