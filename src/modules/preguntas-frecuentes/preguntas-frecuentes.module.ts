import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreguntaFrecuente } from './entities/pregunta-frecuente.entity';
import { PreguntasFrecuentesService } from './preguntas-frecuentes.service';
import { PreguntasFrecuentesController } from './preguntas-frecuentes.controller';
import { AiModule } from '../ia/ia.module';
import { ProyectosModule } from '../proyectos/proyectos.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([PreguntaFrecuente]),
        AiModule, // Provides QdrantVectorService
        ProyectosModule // Provides ProyectosService
    ],
    controllers: [PreguntasFrecuentesController],
    providers: [PreguntasFrecuentesService],
    exports: [PreguntasFrecuentesService]
})
export class PreguntasFrecuentesModule { }
