import { Controller, Get, Req, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { EmpresaService } from './empresa.service';

@ApiTags('Empresa')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('empresa')
export class EmpresaController {
    private readonly logger = new Logger(EmpresaController.name);

    constructor(private empresaService: EmpresaService) { }

    @Get('info')
    @ApiOperation({ summary: 'Obtener información de la empresa actual' })
    async getEmpresaInfo(@Req() req) {
        const user = req.user;
        const empresaId = user?.empresaId || 1; // Default 1
        return this.empresaService.getConfiguracion(empresaId);
    }
}
