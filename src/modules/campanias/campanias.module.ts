import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campania } from './entities/campania.entity';
import { CampaniaProspecto } from './entities/campania-prospecto.entity';
import { CampaniasService } from './campanias.service';
import { CampaniasController } from './campanias.controller';

@Module({
    imports: [TypeOrmModule.forFeature([Campania, CampaniaProspecto])],
    controllers: [CampaniasController],
    providers: [CampaniasService],
    exports: [CampaniasService],
})
export class CampaniasModule { }
