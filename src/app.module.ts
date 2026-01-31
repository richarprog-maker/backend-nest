import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { WebhookModule } from './modules/webhook_meta/webhook.module';
import { AiModule } from './modules/ia/ia.module';
import { CitasModule } from './modules/citas/citas.module';
import { CampaniasModule } from './modules/campanias/campanias.module';
import { ProspectosModule } from './modules/prospectos/prospectos.module';
import { EmpresaModule } from './modules/empresa/empresa.module';
import { ProyectosModule } from './modules/proyectos/proyectos.module';
import { BotsModule } from './modules/bots/bots.module';
import { PreguntasFrecuentesModule } from './modules/preguntas-frecuentes/preguntas-frecuentes.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { databaseConfig } from './config/database.config';
import { PlantillasModule } from './modules/plantillas/plantillas.module';
import { HistorialEnviosModule } from './modules/historial-envios/historial-envios.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { ClasificacionLeadsModule } from './modules/clasificacion-leads/clasificacion-leads.module';

@Module({
    imports: [
        // Configuración de Variables de Entorno
        ConfigModule.forRoot({
            isGlobal: true,
        }),

        // Configuración de Base de Datos
        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => databaseConfig(configService),
        }),

        // Módulos de la Aplicación
        AuthModule,
        InboxModule,
        WebhookModule,
        AiModule,
        CitasModule,
        CampaniasModule,
        ProspectosModule,
        EmpresaModule,
        ProyectosModule,
        BotsModule,
        PreguntasFrecuentesModule,
        DashboardModule,
        PlantillasModule,
        HistorialEnviosModule,
        TasksModule,
        ClasificacionLeadsModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule { }
