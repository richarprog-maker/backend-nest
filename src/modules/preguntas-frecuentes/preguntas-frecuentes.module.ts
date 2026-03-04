import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreguntaFrecuente } from './entities/pregunta-frecuente.entity';
import { PreguntasFrecuentesService } from './preguntas-frecuentes.service';
import { PreguntasFrecuentesController } from './preguntas-frecuentes.controller';
import { AiModule } from '../ia/ia.module';
import { ProyectosModule } from '../proyectos/proyectos.module';
import { ColeccionQdrant } from '../proyectos/entities/coleccion-qdrant.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([PreguntaFrecuente, ColeccionQdrant]),
        AiModule,
        forwardRef(() => ProyectosModule) // importación cruzada
    ],
    controllers: [PreguntasFrecuentesController],
    providers: [PreguntasFrecuentesService],
    exports: [PreguntasFrecuentesService]
})
export class PreguntasFrecuentesModule { }
