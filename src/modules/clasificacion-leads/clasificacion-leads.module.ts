import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HistorialClasificacionLead } from './entities/historial-clasificacion-lead.entity';

@Module({
    imports: [TypeOrmModule.forFeature([HistorialClasificacionLead])],
    controllers: [],
    providers: [],
    exports: [TypeOrmModule],
})
export class ClasificacionLeadsModule { }
