
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecoveryTasksService } from './services/recovery-tasks.service';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { PlantillaMensaje } from '../plantillas/entities/plantilla.entity';
import { HistorialPlantillas } from '../plantillas/entities/historial-plantilla.entity';
import { WebhookModule } from '../webhook_meta/webhook.module';
import { Lead } from '../inbox/entities/lead.entity';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([SesionConversacion, PlantillaMensaje, Lead, HistorialPlantillas]),
        WebhookModule,
    ],
    providers: [RecoveryTasksService],
})
export class TasksModule { }
