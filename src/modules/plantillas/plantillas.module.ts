import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlantillaMensaje } from './entities/plantilla.entity';
import { PlantillasService } from './services/plantillas.service';

@Module({
    imports: [TypeOrmModule.forFeature([PlantillaMensaje])],
    providers: [PlantillasService],
    exports: [PlantillasService],
})
export class PlantillasModule { }
