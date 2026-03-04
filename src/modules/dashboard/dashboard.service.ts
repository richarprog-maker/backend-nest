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
            // Usamos cálculo manual para evitar problemas de Timezone con new Date()
            let mesFinNum = Number(mesHasta) + 1;
            let anioFinNum = Number(añoHasta);

            if (mesFinNum > 12) {
                mesFinNum = 1;
                anioFinNum++;
            }

            const fechaFin = `${anioFinNum}-${String(mesFinNum).padStart(2, '0')}-01`;

            // 2. Query Raw 
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

    async getEstadisticasResumen(empresaId: number, fechaDesde: string, fechaHasta: string, proyectoId?: number, vendedorId?: number, rol?: string) {
        try {
            // Asegurar fechas validas
            const desde = fechaDesde ? `${fechaDesde} 00:00:00` : '2024-01-01 00:00:00';
            const hasta = fechaHasta ? `${fechaHasta} 23:59:59` : new Date().toISOString();

            // === RBAC: Determinar qué proyectos puede ver este usuario ===
            let proyectosPermitidos: number[] | null = null; // null = ver todo

            if (rol && rol !== 'admin' && rol !== 'super_admin' && vendedorId) {
                // Vendedor: solo ve sus proyectos asignados
                const rows = await this.entityManager.query(
                    'SELECT proyecto_id FROM tbl_vendedores_proyectos WHERE id_vendedor = ?',
                    [vendedorId]
                );
                proyectosPermitidos = rows.map((r: any) => r.proyecto_id);
                if (proyectosPermitidos.length === 0) {
                    proyectosPermitidos = [0]; // Sin proyectos asignados -> no ve nada
                }
            }

            // Si se envía proyectoId específico, verificar acceso
            if (proyectoId) {
                if (proyectosPermitidos && !proyectosPermitidos.includes(proyectoId)) {
                    // Vendedor sin acceso a ese proyecto
                    proyectosPermitidos = [0];
                } else {
                    proyectosPermitidos = [proyectoId];
                }
            }

            // === Construir fragmentos SQL dinámicos para filtro de proyecto ===
            const tieneFiltroProy = proyectosPermitidos !== null;
            const proyIdsStr = tieneFiltroProy ? proyectosPermitidos.join(',') : '';

            // 1. Prospectos: Total de leads creados en el rango (filtrados por sesión->proyecto)
            let queryProspectos: string;
            let paramsProspectos: any[];
            if (tieneFiltroProy) {
                queryProspectos = `
                    SELECT COUNT(DISTINCT l.uuid) as total 
                    FROM tbl_leads l
                    INNER JOIN tbl_sesion_conversacion s ON s.lead_uuid = l.uuid AND s.codigo_empresa = l.codigo_empresa
                    WHERE l.codigo_empresa = ? 
                    AND l.fecha_registro >= ? AND l.fecha_registro <= ?
                    AND s.proyecto_id IN (${proyIdsStr})
                `;
            } else {
                queryProspectos = `
                    SELECT COUNT(*) as total 
                    FROM tbl_leads 
                    WHERE codigo_empresa = ? 
                    AND fecha_registro >= ? AND fecha_registro <= ?
                `;
            }
            paramsProspectos = [empresaId, desde, hasta];
            const [resProspectos] = await this.entityManager.query(queryProspectos, paramsProspectos);
            const totalProspectos = Number(resProspectos?.total || 0);

            // 2. Contactados: Leads con al menos un mensaje del cliente (emisor_tipo = 1)
            let queryContactados: string;
            if (tieneFiltroProy) {
                queryContactados = `
                    SELECT COUNT(DISTINCT m.lead_uuid) as total
                    FROM tbl_mensajes m
                    INNER JOIN tbl_sesion_conversacion s ON s.lead_uuid = m.lead_uuid AND s.codigo_empresa = m.codigo_empresa
                    WHERE m.codigo_empresa = ?
                    AND m.id_emisor_tipo = 1
                    AND m.fecha_recibido >= ? AND m.fecha_recibido <= ?
                    AND s.proyecto_id IN (${proyIdsStr})
                `;
            } else {
                queryContactados = `
                    SELECT COUNT(DISTINCT lead_uuid) as total
                    FROM tbl_mensajes
                    WHERE codigo_empresa = ?
                    AND id_emisor_tipo = 1
                    AND fecha_recibido >= ? AND fecha_recibido <= ?
                `;
            }
            const [resContactados] = await this.entityManager.query(queryContactados, [empresaId, desde, hasta]);
            const totalContactados = Number(resContactados?.total || 0);

            // 3. Derivados: Leads CLASIFICADOS por el bot
            let queryDerivados: string;
            if (tieneFiltroProy) {
                queryDerivados = `
                    SELECT COUNT(DISTINCT t2.lead_uuid) as total
                    FROM tbl_historial_clasificacion_lead t1
                    JOIN tbl_sesion_conversacion t2 ON t1.id_sesion = t2.id
                    WHERE t2.codigo_empresa = ?
                    AND t1.fecha_creacion >= ? AND t1.fecha_creacion <= ?
                    AND t2.proyecto_id IN (${proyIdsStr})
                `;
            } else {
                queryDerivados = `
                    SELECT COUNT(DISTINCT t2.lead_uuid) as total
                    FROM tbl_historial_clasificacion_lead t1
                    JOIN tbl_sesion_conversacion t2 ON t1.id_sesion = t2.id
                    WHERE t2.codigo_empresa = ?
                    AND t1.fecha_creacion >= ? AND t1.fecha_creacion <= ?
                `;
            }
            const [resDerivados] = await this.entityManager.query(queryDerivados, [empresaId, desde, hasta]);
            const totalDerivados = Number(resDerivados?.total || 0);

            // 4. Citados: Total de citas filtradas por proyecto del lead (via sesion)
            let queryCitados: string;
            if (tieneFiltroProy) {
                queryCitados = `
                    SELECT COUNT(DISTINCT c.lead_uuid) as total 
                    FROM tbl_citas c
                    INNER JOIN tbl_sesion_conversacion s ON s.lead_uuid = c.lead_uuid AND s.codigo_empresa = c.codigo_empresa
                    WHERE c.codigo_empresa = ? 
                    AND c.fecha_creacion >= ? AND c.fecha_creacion <= ?
                    AND s.proyecto_id IN (${proyIdsStr})
                `;
            } else {
                queryCitados = `
                    SELECT COUNT(DISTINCT lead_uuid) as total 
                    FROM tbl_citas 
                    WHERE codigo_empresa = ? 
                    AND fecha_creacion >= ? AND fecha_creacion <= ?
                `;
            }
            const [resCitados] = await this.entityManager.query(queryCitados, [empresaId, desde, hasta]);
            const totalCitados = Number(resCitados?.total || 0);

            // 5. Lead Scoring (Clasificacion)
            let queryClasificacion: string;
            if (tieneFiltroProy) {
                queryClasificacion = `
                    SELECT t1.clasificacion, COUNT(*) as total
                    FROM tbl_historial_clasificacion_lead t1
                    JOIN tbl_sesion_conversacion t2 ON t1.id_sesion = t2.id
                    WHERE t2.codigo_empresa = ?
                    AND t1.fecha_creacion >= ? AND t1.fecha_creacion <= ?
                    AND t2.proyecto_id IN (${proyIdsStr})
                    AND t1.id = (
                        SELECT MAX(h.id)
                        FROM tbl_historial_clasificacion_lead h
                        JOIN tbl_sesion_conversacion s ON h.id_sesion = s.id
                        WHERE s.lead_uuid = t2.lead_uuid
                    )
                    GROUP BY t1.clasificacion
                `;
            } else {
                queryClasificacion = `
                    SELECT t1.clasificacion, COUNT(*) as total
                    FROM tbl_historial_clasificacion_lead t1
                    JOIN tbl_sesion_conversacion t2 ON t1.id_sesion = t2.id
                    WHERE t2.codigo_empresa = ?
                    AND t1.fecha_creacion >= ? AND t1.fecha_creacion <= ?
                    AND t1.id = (
                        SELECT MAX(h.id)
                        FROM tbl_historial_clasificacion_lead h
                        JOIN tbl_sesion_conversacion s ON h.id_sesion = s.id
                        WHERE s.lead_uuid = t2.lead_uuid
                    )
                    GROUP BY t1.clasificacion
                `;
            }
            const rowsClasificacion = await this.entityManager.query(queryClasificacion, [empresaId, desde, hasta]);

            const clasificacionMap = { pendiente: 0, bajo: 0, medio: 0, alto: 0, descartado: 0 };
            let totalClasificados = 0;

            rowsClasificacion.forEach(r => {
                let key = r.clasificacion?.toLowerCase();
                if (key && (key.includes('descartado'))) key = 'descartado';
                if (key && (key.includes('pendiente'))) key = 'pendiente';

                if (clasificacionMap[key] !== undefined) {
                    clasificacionMap[key] = Number(r.total);
                    totalClasificados += Number(r.total);
                }
            });

            // Leads pendientes
            let queryPendientes: string;
            if (tieneFiltroProy) {
                queryPendientes = `
                    SELECT COUNT(DISTINCT lead_uuid) as total
                    FROM tbl_sesion_conversacion
                    WHERE codigo_empresa = ?
                    AND id_estado = 1
                    AND created_at >= ? AND created_at <= ?
                    AND proyecto_id IN (${proyIdsStr})
                `;
            } else {
                queryPendientes = `
                    SELECT COUNT(DISTINCT lead_uuid) as total
                    FROM tbl_sesion_conversacion
                    WHERE codigo_empresa = ?
                    AND id_estado = 1
                    AND created_at >= ? AND created_at <= ?
                `;
            }
            const [resPendientes] = await this.entityManager.query(queryPendientes, [empresaId, desde, hasta]);
            const leadsPendientes = Number(resPendientes?.total || 0);

            if (leadsPendientes > 0) {
                clasificacionMap.pendiente = leadsPendientes;
                totalClasificados += leadsPendientes;
            }

            const calcPorcentaje = (part: number, total: number) => total > 0 ? Math.round((part / total) * 100) : 0;

            // 6. Asistencia Humana
            let queryAsistenciaHumana: string;
            if (tieneFiltroProy) {
                queryAsistenciaHumana = `
                    SELECT COUNT(DISTINCT m.lead_uuid) as total
                    FROM tbl_mensajes m
                    INNER JOIN tbl_sesion_conversacion s ON s.lead_uuid = m.lead_uuid AND s.codigo_empresa = m.codigo_empresa
                    WHERE m.codigo_empresa = ?
                    AND m.id_emisor_tipo IN (3, 4)
                    AND m.fecha_creacion >= ? AND m.fecha_creacion <= ?
                    AND s.proyecto_id IN (${proyIdsStr})
                `;
            } else {
                queryAsistenciaHumana = `
                    SELECT COUNT(DISTINCT lead_uuid) as total
                    FROM tbl_mensajes
                    WHERE codigo_empresa = ?
                    AND id_emisor_tipo IN (3, 4)
                    AND fecha_creacion >= ? AND fecha_creacion <= ?
                `;
            }
            const [resAsistencia] = await this.entityManager.query(queryAsistenciaHumana, [empresaId, desde, hasta]);
            const totalAsistenciaHumana = Number(resAsistencia?.total || 0);

            // 7. Heatmap y Estadísticas de Mensajes
            let queryHeatmap: string;
            if (tieneFiltroProy) {
                queryHeatmap = `
                    SELECT 
                        WEEKDAY(COALESCE(m.fecha_envio, m.fecha_recibido)) as dia_idx, 
                        HOUR(COALESCE(m.fecha_envio, m.fecha_recibido)) as hora, 
                        COUNT(*) as total
                    FROM tbl_mensajes m
                    INNER JOIN tbl_sesion_conversacion s ON s.lead_uuid = m.lead_uuid AND s.codigo_empresa = m.codigo_empresa
                    WHERE m.codigo_empresa = ? 
                    AND COALESCE(m.fecha_envio, m.fecha_recibido) >= ? 
                    AND COALESCE(m.fecha_envio, m.fecha_recibido) <= ?
                    AND s.proyecto_id IN (${proyIdsStr})
                    GROUP BY dia_idx, hora
                `;
            } else {
                queryHeatmap = `
                    SELECT 
                        WEEKDAY(COALESCE(fecha_envio, fecha_recibido)) as dia_idx, 
                        HOUR(COALESCE(fecha_envio, fecha_recibido)) as hora, 
                        COUNT(*) as total
                    FROM tbl_mensajes
                    WHERE codigo_empresa = ? 
                    AND COALESCE(fecha_envio, fecha_recibido) >= ? 
                    AND COALESCE(fecha_envio, fecha_recibido) <= ?
                    GROUP BY dia_idx, hora
                `;
            }
            const rowsHeatmap = await this.entityManager.query(queryHeatmap, [empresaId, desde, hasta]);

            const diasSemana = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
            const heatmap = {};
            diasSemana.forEach(dia => {
                heatmap[dia] = {};
                for (let h = 0; h < 24; h++) {
                    heatmap[dia][`${String(h).padStart(2, '0')}:00`] = 0;
                }
            });

            const totalPorHora = new Array(24).fill(0);
            const totalPorDia = { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 };

            rowsHeatmap.forEach(row => {
                const diaNombre = diasSemana[row.dia_idx];
                const horaStr = `${String(row.hora).padStart(2, '0')}:00`;
                const total = Number(row.total);

                if (heatmap[diaNombre]) {
                    heatmap[diaNombre][horaStr] = total;
                }
                totalPorHora[row.hora] += total;
                if (totalPorDia[diaNombre] !== undefined) totalPorDia[diaNombre] += total;
            });

            // Hora Pico Matutina (06 - 11)
            let maxMatutina = -1;
            let horaPicoMatutina = 'N/A';
            for (let h = 6; h <= 11; h++) {
                if (totalPorHora[h] > maxMatutina) {
                    maxMatutina = totalPorHora[h];
                    horaPicoMatutina = `${String(h).padStart(2, '0')}:00`;
                }
            }
            if (maxMatutina === 0) horaPicoMatutina = 'N/A';

            // Hora Pico Vespertina (13 - 18)
            let maxVespertina = -1;
            let horaPicoVespertina = 'N/A';
            for (let h = 13; h <= 18; h++) {
                if (totalPorHora[h] > maxVespertina) {
                    maxVespertina = totalPorHora[h];
                    horaPicoVespertina = `${String(h).padStart(2, '0')}:00`;
                }
            }
            if (maxVespertina === 0) horaPicoVespertina = 'N/A';

            // Hora Menor Actividad
            let minActividad = Infinity;
            let horaMenorActividad = 'N/A';
            let hayActividad = totalPorHora.some(t => t > 0);
            if (hayActividad) {
                for (let h = 0; h < 24; h++) {
                    if (totalPorHora[h] < minActividad) {
                        minActividad = totalPorHora[h];
                        horaMenorActividad = `${String(h).padStart(2, '0')}:00`;
                    }
                }
            }

            // Dia Pico
            let maxDiaVal = -1;
            let diaPicoSemana = 'N/A';
            Object.entries(totalPorDia).forEach(([dia, total]) => {
                if (total > maxDiaVal) {
                    maxDiaVal = total;
                    diaPicoSemana = dia.charAt(0).toUpperCase() + dia.slice(1);
                }
            });
            if (maxDiaVal === 0) diaPicoSemana = 'N/A';

            // Mes Pico
            let queryMesPicoNum: string;
            if (tieneFiltroProy) {
                queryMesPicoNum = `
                    SELECT DATE_FORMAT(COALESCE(m.fecha_envio, m.fecha_recibido), '%m') as mes_num, COUNT(*) as total
                    FROM tbl_mensajes m
                    INNER JOIN tbl_sesion_conversacion s ON s.lead_uuid = m.lead_uuid AND s.codigo_empresa = m.codigo_empresa
                    WHERE m.codigo_empresa = ? 
                    AND COALESCE(m.fecha_envio, m.fecha_recibido) >= ? 
                    AND COALESCE(m.fecha_envio, m.fecha_recibido) <= ?
                    AND s.proyecto_id IN (${proyIdsStr})
                    GROUP BY mes_num
                    ORDER BY total DESC
                    LIMIT 1
                `;
            } else {
                queryMesPicoNum = `
                    SELECT DATE_FORMAT(COALESCE(fecha_envio, fecha_recibido), '%m') as mes_num, COUNT(*) as total
                    FROM tbl_mensajes
                    WHERE codigo_empresa = ? 
                    AND COALESCE(fecha_envio, fecha_recibido) >= ? 
                    AND COALESCE(fecha_envio, fecha_recibido) <= ?
                    GROUP BY mes_num
                    ORDER BY total DESC
                    LIMIT 1
                `;
            }
            const [rowMesPico] = await this.entityManager.query(queryMesPicoNum, [empresaId, desde, hasta]);
            const mesesEs = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
            let mesPico = 'N/A';
            if (rowMesPico && rowMesPico.mes_num) {
                const mesIdx = Number(rowMesPico.mes_num) - 1;
                if (mesIdx >= 0 && mesIdx < 12) mesPico = mesesEs[mesIdx];
            }

            return {
                embudoDeConversion: {
                    prospectos: { total: totalProspectos, porcentajeTotal: 100 },
                    contactados: { total: totalContactados, porcentajeTotal: calcPorcentaje(totalContactados, totalProspectos) },
                    derivados: { total: totalDerivados, porcentajeTotal: calcPorcentaje(totalDerivados, totalProspectos) },
                    citados: { total: totalCitados, porcentajeTotal: calcPorcentaje(totalCitados, totalProspectos) }
                },
                estadisticasLeadClasificacion: {
                    pendiente: { total: clasificacionMap.pendiente, porcentajeTotal: calcPorcentaje(clasificacionMap.pendiente, totalClasificados) },
                    bajo: { total: clasificacionMap.bajo, porcentajeTotal: calcPorcentaje(clasificacionMap.bajo, totalClasificados) },
                    medio: { total: clasificacionMap.medio, porcentajeTotal: calcPorcentaje(clasificacionMap.medio, totalClasificados) },
                    alto: { total: clasificacionMap.alto, porcentajeTotal: calcPorcentaje(clasificacionMap.alto, totalClasificados) },
                    descartado: { total: clasificacionMap.descartado, porcentajeTotal: calcPorcentaje(clasificacionMap.descartado, totalClasificados) }
                },
                asistenciaHumana: {
                    total: totalAsistenciaHumana,
                    porcentajeTotal: calcPorcentaje(totalAsistenciaHumana, totalContactados)
                },
                conversacionesAbandonadas: {
                    contactados: totalContactados,
                    abandonados: 0,
                    recuperados: 0
                },
                heatmapVolumenMensajes: {
                    heatmap: heatmap,
                    estadisticas: {
                        horaPicoMatutina: { hora: horaPicoMatutina, totalMensajes: maxMatutina > 0 ? maxMatutina : 0 },
                        horaPicoVespertina: { hora: horaPicoVespertina, totalMensajes: maxVespertina > 0 ? maxVespertina : 0 },
                        horaMenorActividad: { hora: horaMenorActividad, totalMensajes: minActividad !== Infinity ? minActividad : 0 },
                        diaPicoSemana: { dia: diaPicoSemana, totalMensajes: maxDiaVal > 0 ? maxDiaVal : 0 },
                        mesPico: { mes: mesPico, totalMensajes: rowMesPico ? Number(rowMesPico.total) : 0 }
                    }
                }
            };
        } catch (error) {
            this.logger.error(`Error getEstadisticasResumen: ${error.message}`);
            return {
                embudoDeConversion: {
                    prospectos: { total: 0, porcentajeTotal: 0 },
                    contactados: { total: 0, porcentajeTotal: 0 },
                    derivados: { total: 0, porcentajeTotal: 0 },
                    citados: { total: 0, porcentajeTotal: 0 }
                },
                estadisticasLeadClasificacion: {
                    pendiente: { total: 0, porcentajeTotal: 0 },
                    bajo: { total: 0, porcentajeTotal: 0 },
                    medio: { total: 0, porcentajeTotal: 0 },
                    alto: { total: 0, porcentajeTotal: 0 },
                    descartado: { total: 0, porcentajeTotal: 0 }
                },
                conversacionesAbandonadas: {
                    contactados: 0,
                    abandonados: 0,
                    recuperados: 0
                },
                heatmapVolumenMensajes: {
                    heatmap: {},
                    estadisticas: {}
                }
            };
        }
    }
}
