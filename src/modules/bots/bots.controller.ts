import { Controller, Get, Req, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { BotsService } from './bots.service';

@ApiTags('Bots')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('bots') // Ruta base /api/bots (prefijo global api se asume por configuración main)
export class BotsController {
    private readonly logger = new Logger(BotsController.name);

    constructor(private botsService: BotsService) { }

    @Get('')
    @ApiOperation({ summary: 'Listar bots de la empresa actual' })
    async getBots(@Req() req) {
        const user = req.user;
        const empresaId = user?.empresaId || 1;

        return this.botsService.getBotsPorEmpresa(empresaId);
    }
}
