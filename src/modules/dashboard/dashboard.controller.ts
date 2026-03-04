import { Controller, Get, Patch, Body, Query, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('dashboard')
@UseGuards(AuthGuard('jwt'))
export class DashboardController {
    constructor(private readonly dashboardService: DashboardService) { }

    @Get('estadisticas-consumo')
    async getEstadisticas(
        @Req() req,
        @Query('mesDesde') mesDesde: string,
        @Query('añoDesde') añoDesde: number,
        @Query('mesHasta') mesHasta: string,
        @Query('añoHasta') añoHasta: number
    ) {
        const user = req.user;
        const empresaId = user?.empresaId || 1;

        // Default values if not provided (last 12 months)
        if (!mesDesde || !añoDesde) {
            const now = new Date();
            mesHasta = String(now.getMonth() + 1);
            añoHasta = now.getFullYear();

            const lastYear = new Date(now);
            lastYear.setMonth(now.getMonth() - 11);
            mesDesde = String(lastYear.getMonth() + 1);
            añoDesde = lastYear.getFullYear();
        }

        return this.dashboardService.getEstadisticasConsumo(empresaId, mesDesde, añoDesde, mesHasta, añoHasta);
    }

    @Patch('estadisticas-consumo/save-limit')
    async saveLimit(@Req() req, @Body() body: { limite: number }) {
        const user = req.user;
        const empresaId = user?.empresaId || 1;
        return this.dashboardService.saveLimit(empresaId, body.limite);
    }

    @Get('resumen')
    async getEstadisticasResumen(
        @Req() req,
        @Query('fdesde') fechaDesde: string,
        @Query('fhasta') fechaHasta: string,
        @Query('proyectoId') proyectoId: string
    ) {
        const user = req.user;
        const empresaId = user?.empresaId || 1;
        const vendedorId = user?.userId || null;
        const rol = user?.rol || 'vendedor';
        const proyectoIdNum = proyectoId ? Number(proyectoId) : null;
        return this.dashboardService.getEstadisticasResumen(empresaId, fechaDesde, fechaHasta, proyectoIdNum, vendedorId, rol);
    }
}
