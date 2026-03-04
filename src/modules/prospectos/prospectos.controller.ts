import { Controller, Post, Get, Query, Param, UseInterceptors, UploadedFile, Body, Req, BadRequestException, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ServicioExcel } from './services/excel.service';
import { OrquestadorImportacionService } from './services/orquestador-importacion.service';
import { ProspectosService } from './services/prospectos.service';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('prospectos')
export class ProspectosController {
    constructor(
        private readonly orquestadorService: OrquestadorImportacionService,
        private readonly prospectosService: ProspectosService,
        private readonly servicioExcel: ServicioExcel
    ) { }

    @Get('plantilla')
    async descargarPlantilla(@Res() res: Response) {
        const buffer = this.servicioExcel.generarPlantilla();

        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename=plantilla_importacion.xlsx',
            'Content-Length': buffer.length,
        });

        res.send(buffer);
    }

    @Get('base-datos')
    async getBaseDatos(@Query() query: any, @Req() req: any) {
        // Añadir info del usuario para RBAC en la consulta
        query.rol = req.user?.rol || 'vendedor';
        query.vendedorId = req.user?.userId || null;

        const result = await this.prospectosService.findAll(query);
        return {
            success: true,
            data: result
        };
    }

    /**
     * Obtiene el detalle completo de un lead: historial de clasificaciones y citas
     */
    @Get('detalle-lead/:leadUuid')
    async getDetalleLeadClasificacion(@Param('leadUuid') leadUuid: string) {
        return this.prospectosService.getDetalleLeadClasificacion(leadUuid);
    }

    @Post('procesar-excel-upload')
    @UseInterceptors(FileInterceptor('excel'))
    async procesarExcel(
        @UploadedFile() file: Express.Multer.File,
        @Body() body: any,
        @Req() req: any
    ) {
        if (!file) {
            throw new BadRequestException('No se ha subido ningún archivo.');
        }

        // Obtener la empresa del usuario autenticado (asumiendo que req.user tiene esa info)
        // Por defecto usaremos 1 si no hay auth implementado completamente en el request mock
        const codigoEmpresa = req.user?.codigoEmpresa || 1;

        const proposito = body.proposito_registro || 'campania';
        const nombreBd = body.nombre_bd || 'Importacion ' + new Date().toISOString();

        const resultado = await this.orquestadorService.procesarArchivoExcel(
            file.buffer,
            codigoEmpresa,
            proposito,
            nombreBd
        );

        return {
            success: true,
            message: 'Proceso de importación finalizado',
            data: resultado
        };
    }
}
