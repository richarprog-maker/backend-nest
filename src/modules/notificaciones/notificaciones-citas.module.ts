import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendedor } from '../auth/entities/vendedor.entity';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { Lead } from '../inbox/entities/lead.entity';
import { VendedorProyecto } from '../proyectos/entities/asesor-proyecto.entity';
import { WebhookModule } from '../webhook_meta/webhook.module';
import { PlantillaNotificacionAsesor } from './entities/plantilla-notificacion-asesor.entity';
import { NotificacionesCitasService } from './notificaciones-citas.service';

@Module({
    imports: [
        ConfigModule,
        forwardRef(() => WebhookModule),
        TypeOrmModule.forFeature([
            Vendedor,
            Lead,
            SesionConversacion,
            VendedorProyecto,
            PlantillaNotificacionAsesor,
        ]),
    ],
    providers: [NotificacionesCitasService],
    exports: [NotificacionesCitasService],
})
export class NotificacionesCitasModule { }
