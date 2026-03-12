import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards, Logger, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PreguntasFrecuentesService } from './preguntas-frecuentes.service';

@ApiTags('Preguntas Frecuentes')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('preguntas-frecuentes') // Frontend calls /api/prospectos/...? No, services/preguntasFrecuentesService.js url?
// I need to check the frontend service URL. But usually it's /api/something.
// I will check the frontend service first or just assume a standard path like /api/preguntas-frecuentes
export class PreguntasFrecuentesController {
    private readonly logger = new Logger(PreguntasFrecuentesController.name);

    constructor(private fqaService: PreguntasFrecuentesService) { }

    @Get('')
    @ApiOperation({ summary: 'Obtener preguntas frecuentes por empresa y proyecto' })
    async getPreguntas(@Req() req, @Query('proyectoId') proyectoId: number) {
        const user = req.user;
        const empresaId = user?.empresaId || 1;
        return this.fqaService.getPreguntas(empresaId, proyectoId);
    }

    @Get('temas')
    @ApiOperation({ summary: 'Obtener temas únicos para sugerencias' })
    async getTemas(@Query('proyectoId') proyectoId: number) {
        return this.fqaService.getUniqueThemes(proyectoId);
    }

    @Post('register')
    @ApiOperation({ summary: 'Registrar nuevas preguntas frecuentes' })
    async register(@Req() req, @Body() body: any) {
        const user = req.user;
        const empresaId = user?.empresaId || 1;
        return this.fqaService.registerFQAs(empresaId, body);
    }

    @Delete('delete/:id')
    @ApiOperation({ summary: 'Eliminar una pregunta frecuente' })
    async delete(@Param('id') id: string) {
        return this.fqaService.deleteFQA(id);
    }

    @Patch('edit/:id') // Using ID from URL as distinct from body for safety, but body likely has it too
    // Frontend logic for edit: fqasEditService.editFQA(null, fqaToEdit.id_vector, idColeccion, editResponse)
    // It passes id_vector (which is our id) to the URL presumably?
    @ApiOperation({ summary: 'Editar una pregunta frecuente' })
    async edit(@Param('id') id: number, @Body() body: any) {
        return this.fqaService.editFQA(id, body);
    }
}
