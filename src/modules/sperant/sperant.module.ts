import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../inbox/entities/lead.entity';
import { Mensaje } from '../inbox/entities/mensaje.entity';
import { OrigenDato } from '../inbox/entities/origen-dato.entity';
import { Prospecto } from '../inbox/entities/prospecto.entity';
import { Cita } from '../citas/entities/cita.entity';
import { HistorialEnvio } from '../historial-envios/entities/historial-envio.entity';
import { HistorialChatAi } from '../ia/entities/historial-chat-ai.entity';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { PlantillaMensaje } from '../plantillas/entities/plantilla.entity';
import { Proyecto } from '../proyectos/entities/proyecto.entity';
import { UnidadProyecto } from '../proyectos/entities/unidad-proyecto.entity';
import { HistorialEnviosModule } from '../historial-envios/historial-envios.module';
import { PlantillasModule } from '../plantillas/plantillas.module';
import { WebhookModule } from '../webhook_meta/webhook.module';
import { WebhookSperantController } from './webhook-sperant.controller';
import { EventoWebhookSperant } from './entities/evento-webhook-sperant.entity';
import { MapeoContactoSperant } from './entities/mapeo-contacto-sperant.entity';
import { SincronizacionCitaSperant } from './entities/sincronizacion-cita-sperant.entity';
import { SincronizacionProformaSperant } from './entities/sincronizacion-proforma-sperant.entity';
import { SperantProcessor } from './processors/sperant.processor';
import { COLA_SPERANT } from './services/constantes-sperant';
import { ServicioApiSperantService } from './services/servicio-api-sperant.service';
import { ServicioProyectosSperantService } from './services/servicio-proyectos-sperant.service';
import { ServicioSperantService } from './services/servicio-sperant.service';
import { WebhookSperantService } from './services/webhook-sperant.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            EventoWebhookSperant,
            MapeoContactoSperant,
            SincronizacionCitaSperant,
            SincronizacionProformaSperant,
            Lead,
            Prospecto,
            OrigenDato,
            SesionConversacion,
            Mensaje,
            HistorialChatAi,
            PlantillaMensaje,
            HistorialEnvio,
            Cita,
            Proyecto,
            UnidadProyecto,
        ]),
        BullModule.registerQueue({
            name: COLA_SPERANT,
        }),
        PlantillasModule,
        HistorialEnviosModule,
        WebhookModule,
    ],
    controllers: [WebhookSperantController],
    providers: [
        WebhookSperantService,
        ServicioSperantService,
        ServicioApiSperantService,
        ServicioProyectosSperantService,
        SperantProcessor,
    ],
    exports: [ServicioSperantService, ServicioProyectosSperantService],
})
export class SperantModule { }
