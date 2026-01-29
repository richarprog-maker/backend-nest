import { Controller, Post, Get, Query, UseInterceptors, UploadedFile, Body, Req, BadRequestException, Res } from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ServicioExcel } from './services/excel.service';
import { OrquestadorImportacionService } from './services/orquestador-importacion.service';
import { ProspectosService } from './services/prospectos.service';

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
    async getBaseDatos(@Query() query: any) {
        const result = await this.prospectosService.findAll(query);
        return {
            success: true,
            data: result
        };
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
