import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PlantillaCampania } from './entities/plantilla-campania.entity';
import { CredencialesWapi } from '../webhook_meta/entities/credenciales-wapi.entity';
import { PlantillasCampaniasService } from './plantillas-campanias.service';
import { PlantillasCampaniasController } from './plantillas-campanias.controller';
import { MetaTemplatesService } from './services/meta-templates.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([PlantillaCampania, CredencialesWapi]),
        ConfigModule,
    ],
    controllers: [PlantillasCampaniasController],
    providers: [PlantillasCampaniasService, MetaTemplatesService],
    exports: [PlantillasCampaniasService, MetaTemplatesService],
})
export class PlantillasCampaniasModule { }
