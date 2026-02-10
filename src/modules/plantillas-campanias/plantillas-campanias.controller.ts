import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    ParseIntPipe,
} from '@nestjs/common';
import { PlantillasCampaniasService } from './plantillas-campanias.service';
import { CreatePlantillaCampaniaDto } from './dto/create-plantilla-campania.dto';
import { UpdatePlantillaCampaniaDto } from './dto/update-plantilla-campania.dto';

@Controller('plantillas-campanias')
export class PlantillasCampaniasController {
    constructor(
        private readonly plantillasService: PlantillasCampaniasService,
    ) { }

    @Post()
    crear(@Body() dto: CreatePlantillaCampaniaDto) {
        return this.plantillasService.crear(dto);
    }

    @Get()
    obtenerTodas(@Query('codigoEmpresa', ParseIntPipe) codigoEmpresa: number) {
        return this.plantillasService.obtenerTodas(codigoEmpresa);
    }

    @Get(':id')
    obtenerPorId(@Param('id', ParseIntPipe) id: number) {
        return this.plantillasService.obtenerPorId(id);
    }

    @Put(':id')
    actualizar(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdatePlantillaCampaniaDto,
    ) {
        return this.plantillasService.actualizar(id, dto);
    }

    @Delete(':id')
    eliminar(@Param('id', ParseIntPipe) id: number) {
        return this.plantillasService.eliminar(id);
    }
}
