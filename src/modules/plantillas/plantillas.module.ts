import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlantillaMensaje } from './entities/plantilla.entity';
import { PlantillasService } from './services/plantillas.service';
import { HistorialPlantillas } from './entities/historial-plantilla.entity';

@Module({
    imports: [TypeOrmModule.forFeature([PlantillaMensaje, HistorialPlantillas])],
    providers: [PlantillasService],
    exports: [PlantillasService],
})
export class PlantillasModule { }
