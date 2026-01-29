import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { CampaniasService } from './campanias.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('campanias')
@UseGuards(JwtAuthGuard)
export class CampaniasController {
    constructor(private readonly campaniasService: CampaniasService) { }

    @Post()
    async crear(@Body() createDto: any, @Request() req) {
        // Asumimos que el usuario tiene código de empresa en el JWT o se pasa
        // Por simplicidad, tomamos del body o mock
        const codigoEmpresa = req.user.codigoEmpresa || 1;
        return this.campaniasService.crear({ ...createDto, codigoEmpresa });
    }

    @Get()
    async listar(@Request() req) {
        const codigoEmpresa = req.user.codigoEmpresa || 1;
        return this.campaniasService.listar(codigoEmpresa);
    }

    @Get(':id')
    async obtener(@Param('id') id: string) {
        return this.campaniasService.obtenerPorId(+id);
    }
}
