import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cita } from './entities/cita.entity';
import { CitasService } from './citas.service';
// import { CitasController } from './citas.controller'; // Pendiente si se requiere API externa

@Module({
    imports: [TypeOrmModule.forFeature([Cita])],
    controllers: [],
    providers: [CitasService],
    exports: [CitasService],
})
export class CitasModule { }
