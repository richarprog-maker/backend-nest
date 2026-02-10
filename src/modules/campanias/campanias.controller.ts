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
        const safeInt = (val: any) => (val && !isNaN(Number(val))) ? Number(val) : null;

        let plantillaNombre = null;
        if (body.plantillaNombre) {
            plantillaNombre = body.plantillaNombre;
        } else if (body.plantilla) {
            try {
                const plantillaObj = typeof body.plantilla === 'string' ? JSON.parse(body.plantilla) : body.plantilla;
                plantillaNombre = plantillaObj.nombre;
            } catch (e) {
                // Si falla el parseo, ignoramos
            }
        }

        const data = {
            nombre: body.nombre,
            descripcion: body.descripcion,
            plantillaId: safeInt(body.plantillaId),
            plantillaNombre: plantillaNombre,
            plantillaContenido: body.plantillaContenido,
            plantillaParametros: body.plantillaParametros ? JSON.parse(body.plantillaParametros) : null,
            codigoEmpresa: safeInt(body.codigoEmpresa) || 1,
            usuarioId: safeInt(body.usuarioId),
            filtrosAudiencia: body.filtrosAudiencia ? JSON.parse(body.filtrosAudiencia) : null,
            fechaProgramada: body.fechaProgramada || null
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

    @Patch(':id/toggle')
    async toggleCampania(
        @Param('id') id: string, 
        @Body() body: { activar: boolean }
    ) {
        const nuevoEstado = body.activar ? 'habilitado' : 'deshabilitado';
        return this.campaniasService.cambiarEstado(+id, nuevoEstado);
    }

    @Post('actualizar/:id')
    actualizar(@Param('id') id: string, @Body() body: any) {
        return this.campaniasService.actualizar(+id, body);
    }

    @Post('plantilla/crear-en-meta')
    crearPlantillaEnMeta(@Body() body: { plantillaId: number, codigoEmpresa: number }) {
        return this.campaniasService.crearPlantillaEnMeta(body.plantillaId, body.codigoEmpresa);
    }

    @Post('plantillas/sincronizar')
    sincronizarPlantillas(@Body('codigoEmpresa') codigoEmpresa: number) {
        return this.campaniasService.sincronizarPlantillas(codigoEmpresa);
    }

    @Get('plantillas/meta-debug')
    listarPlantillasMeta(@Query('codigoEmpresa') codigoEmpresa: number) {
        return this.campaniasService.listarPlantillasMeta(codigoEmpresa || 1);
    }

    @Post('plantilla/verificar-estado')
    verificarEstadoPlantilla(@Body() body: { plantillaId: number, codigoEmpresa: number }) {
        return this.campaniasService.verificarEstadoPlantilla(body.plantillaId, body.codigoEmpresa);
    }
}

