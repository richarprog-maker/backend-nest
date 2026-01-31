import { Controller, Get, Post, Body, Param, UseInterceptors, UploadedFiles, Query, Delete, Patch } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CampaniasService } from './campanias.service';

@Controller('campanias')
export class CampaniasController {
    constructor(private readonly campaniasService: CampaniasService) { }

    @Post('crear')
    @UseInterceptors(FileFieldsInterceptor([
        { name: 'excel', maxCount: 1 },
        { name: 'imagen', maxCount: 1 },
    ]))
    create(
        @Body() body: any,
        @UploadedFiles() files: { excel?: Express.Multer.File[], imagen?: Express.Multer.File[] }
    ) {
        // El body llega como string en form-data, parsear si es necesario o usar DTO con transformación
        // Por simplicidad, asumimos que body trae las propiedades planas o JSON parseado por Nest si es application/json (pero aquí es multipart)

        // Si usamos FormData, los números llegan como strings "1"
        const safeInt = (val: any) => (val && !isNaN(Number(val))) ? Number(val) : null;

        const data = {
            nombre: body.nombre,
            descripcion: body.descripcion,
            plantillaId: safeInt(body.plantillaId),
            codigoEmpresa: safeInt(body.codigoEmpresa) || 1, // Default temporal
            usuarioId: safeInt(body.usuarioId),
            filtrosAudiencia: body.filtrosAudiencia ? JSON.parse(body.filtrosAudiencia) : null
        };

        return this.campaniasService.crear(data, files);
    }

    @Get('lista')
    findAll(@Query('codigoEmpresa') codigoEmpresa: string) {
        return this.campaniasService.listar(parseInt(codigoEmpresa));
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.campaniasService.obtenerPorId(+id);
    }

    @Post(':id/lanzar')
    lanzar(@Param('id') id: string, @Body('codigoEmpresa') codigoEmpresa: number) {
        return this.campaniasService.lanzar(+id, codigoEmpresa || 1);
    }

    @Delete('eliminar/:id')
    eliminar(@Param('id') id: string) {
        return this.campaniasService.eliminar(+id);
    }

    @Patch('cambiar-estado')
    cambiarEstado(@Body() body: { id_campania: number, nuevo_estado: string }) {
        return this.campaniasService.cambiarEstado(body.id_campania, body.nuevo_estado);
    }

    @Post('actualizar/:id')
    actualizar(@Param('id') id: string, @Body() body: any) {
        // TODO: Manejar archivos en actualización tambien si se requiere
        return this.campaniasService.actualizar(+id, body);
    }
}
