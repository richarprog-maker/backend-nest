import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ia.service';
import { PromptService } from './prompt.service';
import { ToolsExecutionService } from './tools/tools-execution.service';
import { HistorialChatService } from './historial-chat.service';
import { QdrantVectorService } from './qdrant-vector.service';
import { AgentService } from './agent.service';
import { ProjectsSearchService } from './projects-search.service';
import { HistorialChatAi } from './entities/historial-chat-ai.entity';
import { SesionConversacion } from './entities/sesion-conversacion.entity';
import { Bot } from './entities/bot.entity';
import { Lead } from '../inbox/entities/lead.entity';
import { Cita } from '../citas/entities/cita.entity';
import { Proyecto } from '../proyectos/entities/proyecto.entity';
import { CitasModule } from '../citas/citas.module';
import { RedisModule } from '../common/redis/redis.module';
import { InboxModule } from '../inbox/inbox.module';
import { ClasificacionLeadsModule } from '../clasificacion-leads/clasificacion-leads.module';
import { ResumenConversacionService } from './resumen-conversacion.service';

@Module({
    imports: [
        ConfigModule,
        CitasModule,
        RedisModule,
        forwardRef(() => import('../webhook_meta/webhook.module').then(m => m.WebhookModule)),
        forwardRef(() => InboxModule),
        TypeOrmModule.forFeature([HistorialChatAi, SesionConversacion, Bot, Lead, Cita, Proyecto]),
        ClasificacionLeadsModule
    ],
    providers: [
        AiService,
        PromptService,
        ToolsExecutionService,
        HistorialChatService,
        QdrantVectorService,
        AgentService,
        ProjectsSearchService,
        ResumenConversacionService,
    ],
    exports: [AiService, HistorialChatService, QdrantVectorService, AgentService, ProjectsSearchService],
})
export class AiModule { }
