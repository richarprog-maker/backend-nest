import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HistorialEnvio } from './entities/historial-envio.entity';
import { HistorialEnviosService } from './services/historial-envios.service';

@Module({
    imports: [TypeOrmModule.forFeature([HistorialEnvio])],
    providers: [HistorialEnviosService],
    exports: [HistorialEnviosService],
})
export class HistorialEnviosModule { }
