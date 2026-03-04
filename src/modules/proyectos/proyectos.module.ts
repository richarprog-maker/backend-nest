import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Proyecto } from './entities/proyecto.entity';
import { VendedorProyecto } from './entities/asesor-proyecto.entity';
import { ProyectosService } from './proyectos.service';
import { ProyectosController } from './proyectos.controller';
import { PreguntasFrecuentesModule } from '../preguntas-frecuentes/preguntas-frecuentes.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Proyecto, VendedorProyecto]),
        forwardRef(() => PreguntasFrecuentesModule)
    ],
    controllers: [ProyectosController],
    providers: [ProyectosService],
    exports: [ProyectosService]
})
export class ProyectosModule { }

