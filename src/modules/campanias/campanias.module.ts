import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Campania } from './entities/campania.entity';
import { CampaniaDetalle } from './entities/campania-detalle.entity';
import { CampaniaProgramada } from './entities/campania-programada.entity';
import { CampaniasService } from './campanias.service';
import { CampaniasController } from './campanias.controller';
import { CampaniasProcessor } from './campanias.processor';
import { WebhookModule } from '../webhook_meta/webhook.module';
import { PlantillasCampaniasModule } from '../plantillas-campanias/plantillas-campanias.module';
import { PlantillasModule } from '../plantillas/plantillas.module';
import { Lead } from '../inbox/entities/lead.entity';
import { Prospecto } from '../inbox/entities/prospecto.entity';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { HistorialClasificacionLead } from '../clasificacion-leads/entities/historial-clasificacion-lead.entity';
import { Mensaje } from '../inbox/entities/mensaje.entity';
import { Vendedor } from '../auth/entities/vendedor.entity';
import { Proyecto } from '../proyectos/entities/proyecto.entity';
import { VendedorProyecto } from '../proyectos/entities/asesor-proyecto.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Campania,
            CampaniaDetalle,
            CampaniaProgramada,
            Lead,
            Prospecto,
            SesionConversacion,
            HistorialClasificacionLead,
            Mensaje,
            Vendedor,
            Proyecto,
            VendedorProyecto
        ]),
        BullModule.registerQueue({
            name: 'campanias',
        }),
        WebhookModule,
        PlantillasCampaniasModule,
        PlantillasModule,
    ],
    controllers: [CampaniasController],
    providers: [CampaniasService, CampaniasProcessor],
    exports: [CampaniasService],
})
export class CampaniasModule { }
