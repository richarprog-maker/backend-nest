import { Controller, Get, Patch, Body, Param, Req, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ProyectosService } from './proyectos.service';

@ApiTags('Proyectos')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('proyecto')
export class ProyectosController {
    private readonly logger = new Logger(ProyectosController.name);

    constructor(private proyectosService: ProyectosService) { }

    @Get('empresa')
    @ApiOperation({ summary: 'Listar proyectos de la empresa actual' })
    async getProyectosEmpresa(@Req() req) {
        const user = req.user;
        const empresaId = user?.empresaId || 1;

        try {
            const proyectos = await this.proyectosService.getProyectosPorEmpresa(empresaId);
            return proyectos; // Frontend espera array directo para este endpoint según uso
        } catch (error) {
            return [];
        }
    }

    @Get('info/:id')
    @ApiOperation({ summary: 'Obtener información detallada de un proyecto' })
    async getProyectoInfo(@Param('id') id: number, @Req() req) {
        const user = req.user;
        const empresaId = user?.empresaId || 1;

        const data = await this.proyectosService.getProyectoInfo(id, empresaId);
        if (!data) {
            return { Status: 'Error', message: 'Proyecto no encontrado' };
        }
        return { Status: 'Success', data: data };
    }

    @Patch('update/:id')
    @ApiOperation({ summary: 'Actualizar información de un proyecto' })
    async updateProyecto(@Param('id') id: number, @Body() body: any, @Req() req) {
        const user = req.user;
        const empresaId = user?.empresaId || 1;

        try {
            const result = await this.proyectosService.updateProyecto(id, empresaId, body);
            return { Status: 'Success', ...result };
        } catch (error) {
            return { Status: 'Error', message: error.message };
        }
    }
}
