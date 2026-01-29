import { Injectable, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';

@Injectable()
export class DashboardService {
    private readonly logger = new Logger(DashboardService.name);

    constructor(
        @InjectEntityManager()
        private entityManager: EntityManager
    ) { }

    async getEstadisticasConsumo(empresaId: number, mesDesde: string, añoDesde: number, mesHasta: string, añoHasta: number) {
        try {
            // 1. Construir fechas para SQL
            const fechaInicio = `${añoDesde}-${String(mesDesde).padStart(2, '0')}-01`;

            // Para fechaHasta, necesitamos el primer día del mes siguiente
            const fechaFinDate = new Date(Number(añoHasta), Number(mesHasta), 1); // Mes es 0-indexed en JS constructor, pero si pasamos (año, mes), donde mes ya es el siguiente... 
            // Espera, la logica legacy usa: ultimo mes + 1. 
            // Si mesHasta es 12 (Diciembre), new Date(2025, 12, 1) crea Enero 2026. Correcto.

            const fechaFin = fechaFinDate.toISOString().split('T')[0];

            // 2. Query Raw (Replicada de legacy)
            const query = `
                SELECT 
                    DATE_FORMAT(COALESCE(fecha_envio, fecha_recibido), '%Y-%m') AS anio_mes,
                    COUNT(*) AS total_conversaciones_facturables
                FROM tbl_mensajes
                WHERE 
                    codigo_empresa = ?
                    AND COALESCE(fecha_envio, fecha_recibido) >= ?
                    AND COALESCE(fecha_envio, fecha_recibido) < ?
                    AND conversacion_facturable = 1
                GROUP BY DATE_FORMAT(COALESCE(fecha_envio, fecha_recibido), '%Y-%m')
                ORDER BY anio_mes;
            `;

            const rows = await this.entityManager.query(query, [empresaId, fechaInicio, fechaFin]);

            // 3. Obtener Configuración de Empresa
            const empresaQuery = `SELECT configuracion_json FROM tbl_empresas WHERE id_empresa = ?`;
            const [empresaRow] = await this.entityManager.query(empresaQuery, [empresaId]);
            const config = empresaRow?.configuracion_json || {};

            // 4. Mapear y Rellenar
            const serieCompleta = this.generarSerieCompletaMeses(mesDesde, añoDesde, mesHasta, añoHasta);

            const datosMap = new Map();
            rows.forEach(row => {
                datosMap.set(row.anio_mes, Number(row.total_conversaciones_facturables));
            });

            const resultado = serieCompleta.map((item, index) => {
                const valor = datosMap.get(item.anio_mes) || 0;
                return {
                    orden: index + 1,
                    label: item.label,
                    valor: valor
                };
            });

            return {
                data: [{
                    serie: resultado,
                    limite: config.limite_alerta_conversaciones || 300,
                    conversacionesContratadas: config.max_conversaciones || 0,
                    planCompartido: !!config.plan_compartido
                }]
            };

        } catch (error) {
            this.logger.error(`Error getEstadisticasConsumo: ${error.message}`);
            throw error;
        }
    }

    async saveLimit(empresaId: number, limite: number) {
        try {
            // 1. Obtener config actual
            const empresaQuery = `SELECT configuracion_json FROM tbl_empresas WHERE id_empresa = ?`;
            const [empresaRow] = await this.entityManager.query(empresaQuery, [empresaId]);
            let config = empresaRow?.configuracion_json || {};

            // 2. Actualizar limite
            config = {
                ...config,
                limite_alerta_conversaciones: limite
            };

            // 3. Guardar
            await this.entityManager.query(
                `UPDATE tbl_empresas SET configuracion_json = ? WHERE id_empresa = ?`,
                [JSON.stringify(config), empresaId]
            );

            return { success: true, limite };

        } catch (error) {
            this.logger.error(`Error saveLimit: ${error.message}`);
            throw error;
        }
    }

    private generarSerieCompletaMeses(mesInicioStr: string, anioInicio: number, mesFinStr: string, anioFin: number) {
        const mesesNombres = [
            'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
            'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
        ];

        const mesInicio = Number(mesInicioStr);
        const mesFin = Number(mesFinStr);

        const fechaActual = new Date(anioInicio, mesInicio - 1, 1);
        const fechaLimite = new Date(anioFin, mesFin - 1, 1);

        const serie = [];

        while (fechaActual <= fechaLimite) {
            const y = fechaActual.getFullYear();
            const m = fechaActual.getMonth() + 1;
            const anioMes = `${y}-${String(m).padStart(2, '0')}`;
            const label = `${mesesNombres[m - 1]}-${y}`;

            serie.push({ anio_mes: anioMes, label });

            fechaActual.setMonth(fechaActual.getMonth() + 1);
        }

        return serie;
    }
}
