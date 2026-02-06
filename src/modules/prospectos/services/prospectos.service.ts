import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Prospecto } from '../../inbox/entities/prospecto.entity';
import { Lead } from '../../inbox/entities/lead.entity';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';
import { HistorialClasificacionLead } from '../../clasificacion-leads/entities/historial-clasificacion-lead.entity';
import { Cita } from '../../citas/entities/cita.entity';

@Injectable()
export class ProspectosService {
    private readonly logger = new Logger(ProspectosService.name);

    constructor(
        @InjectRepository(Prospecto) private prospectoRepo: Repository<Prospecto>,
        @InjectRepository(Lead) private leadRepo: Repository<Lead>,
        @InjectRepository(SesionConversacion) private sesionRepo: Repository<SesionConversacion>,
        @InjectRepository(HistorialClasificacionLead) private clasificacionRepo: Repository<HistorialClasificacionLead>,
        @InjectRepository(Cita) private citaRepo: Repository<Cita>,
        private dataSource: DataSource,
    ) { }

    async findAll(query: any) {
        const page = query.page || 1;
        const limit = query.limit || 50;
        const skip = (page - 1) * limit;

        // Query principal con subqueries para clasificación y citas
        const qb = this.dataSource.createQueryBuilder()
            .select([
                'p.id_prospecto as id_prospecto',
                'p.id_lead as id_lead',
                'p.interes_nombre as interes_nombre',
                'p.origen_dato as origen_dato',
                'p.estado_gestion as estado_gestion',
                'p.json_data as json_data',
                'p.fecha_registro as fecha_registro',
                'l.uuid as lead_uuid',
                'l.nombre as nombre_lead',
                'l.apellido as apellido_lead',
                'l.telefono_principal as telefono',
                'l.email as email',
                'l.dni as dni',
                'l.ciudad as ciudad',
                // Subquery para última clasificación
                `(SELECT hcl.clasificacion 
                  FROM tbl_historial_clasificacion_lead hcl
                  INNER JOIN tbl_sesion_conversacion sc ON sc.id = hcl.id_sesion
                  WHERE sc.lead_uuid = l.uuid
                  ORDER BY hcl.fecha_creacion DESC
                  LIMIT 1) as ultima_clasificacion`,
                // Subquery para contar clasificaciones
                `(SELECT COUNT(*) 
                  FROM tbl_historial_clasificacion_lead hcl
                  INNER JOIN tbl_sesion_conversacion sc ON sc.id = hcl.id_sesion
                  WHERE sc.lead_uuid = l.uuid) as total_clasificaciones`,
                // Subquery para contar citas
                `(SELECT COUNT(*) 
                  FROM tbl_citas c
                  WHERE c.lead_uuid = l.uuid) as total_citas`,
                // Subquery para estado sesión
                `(SELECT sc.id_estado 
                  FROM tbl_sesion_conversacion sc
                  WHERE sc.lead_uuid = l.uuid
                  ORDER BY sc.updated_at DESC
                  LIMIT 1) as estado_sesion`,
            ])
            .from('tbl_prospectos', 'p')
            .leftJoin('tbl_leads', 'l', 'l.id_lead = p.id_lead')
            .orderBy('p.fecha_registro', 'DESC')
            .offset(skip)
            .limit(limit);

        // Filtro de búsqueda
        if (query.search) {
            qb.andWhere(
                '(l.nombre LIKE :s OR l.apellido LIKE :s OR l.telefono_principal LIKE :s OR l.email LIKE :s)',
                { s: `%${query.search}%` }
            );
        }

        // Filtro por clasificación
        if (query.estado_clasificacion) {
            if (query.estado_clasificacion === 'pendiente') {
                // Sin clasificación
                qb.andWhere(`
                    NOT EXISTS (
                        SELECT 1 FROM tbl_historial_clasificacion_lead hcl
                        INNER JOIN tbl_sesion_conversacion sc ON sc.id = hcl.id_sesion
                        WHERE sc.lead_uuid = l.uuid
                    )
                `);
            } else {
                // Con clasificación específica
                qb.andWhere(`
                    EXISTS (
                        SELECT 1 FROM tbl_historial_clasificacion_lead hcl
                        INNER JOIN tbl_sesion_conversacion sc ON sc.id = hcl.id_sesion
                        WHERE sc.lead_uuid = l.uuid
                        AND hcl.clasificacion = :clasificacion
                        AND hcl.id = (
                            SELECT MAX(hcl2.id) FROM tbl_historial_clasificacion_lead hcl2
                            INNER JOIN tbl_sesion_conversacion sc2 ON sc2.id = hcl2.id_sesion
                            WHERE sc2.lead_uuid = l.uuid
                        )
                    )
                `, { clasificacion: query.estado_clasificacion });
            }
        }

        qb.andWhere('p.id_prospecto IN (SELECT MAX(p2.id_prospecto) FROM tbl_prospectos p2 GROUP BY p2.id_lead)');

        // Obtener datos y total
        const rawData = await qb.getRawMany();

        // Count total
        const countQb = this.dataSource.createQueryBuilder()
            .select('COUNT(DISTINCT l.id_lead)', 'total') // Contar leads únicos
            .from('tbl_prospectos', 'p')
            .leftJoin('tbl_leads', 'l', 'l.id_lead = p.id_lead');

        countQb.andWhere('p.id_prospecto IN (SELECT MAX(p2.id_prospecto) FROM tbl_prospectos p2 GROUP BY p2.id_lead)');

        if (query.search) {
            countQb.andWhere(
                '(l.nombre LIKE :s OR l.apellido LIKE :s OR l.telefono_principal LIKE :s OR l.email LIKE :s)',
                { s: `%${query.search}%` }
            );
        }

        if (query.estado_clasificacion) {
            if (query.estado_clasificacion === 'pendiente') {
                countQb.andWhere(`
                    NOT EXISTS (
                        SELECT 1 FROM tbl_historial_clasificacion_lead hcl
                        INNER JOIN tbl_sesion_conversacion sc ON sc.id = hcl.id_sesion
                        WHERE sc.lead_uuid = l.uuid
                    )
                `);
            } else {
                countQb.andWhere(`
                    EXISTS (
                        SELECT 1 FROM tbl_historial_clasificacion_lead hcl
                        INNER JOIN tbl_sesion_conversacion sc ON sc.id = hcl.id_sesion
                        WHERE sc.lead_uuid = l.uuid
                        AND hcl.clasificacion = :clasificacion
                        AND hcl.id = (
                            SELECT MAX(hcl2.id) FROM tbl_historial_clasificacion_lead hcl2
                            INNER JOIN tbl_sesion_conversacion sc2 ON sc2.id = hcl2.id_sesion
                            WHERE sc2.lead_uuid = l.uuid
                        )
                    )
                `, { clasificacion: query.estado_clasificacion });
            }
        }

        const countResult = await countQb.getRawOne();
        const total = parseInt(countResult?.total || '0', 10);

        // Mapeo para el frontend
        const items = rawData.map(row => {
            const json = row.json_data ? (typeof row.json_data === 'string' ? JSON.parse(row.json_data) : row.json_data) : {};

            // Determinar estado de clasificación
            let estadoClasificacion = 'pendiente';
            if (row.ultima_clasificacion) {
                estadoClasificacion = row.ultima_clasificacion;
            }

            return {
                id_prospecto: row.id_prospecto,
                idLead: row.id_lead,
                leadUuid: row.lead_uuid,
                nombre: row.interes_nombre || (row.origen_dato === 'Excel' ? 'Importado' : 'Lead'),
                tipoRegistro: row.origen_dato === 'Excel' ? 'Manual' : 'Automático',
                etiqueta: 'Prospecto',
                fecha_creacion: row.fecha_registro,
                origen: row.origen_dato,
                contactado: row.estado_gestion,

                // Datos Persona
                nombrePersona: row.nombre_lead,
                apellido: row.apellido_lead,
                dni: row.dni,
                celular: row.telefono,
                correo: row.email,

                // Clasificación (nuevo)
                estadoClasificacion,
                totalClasificaciones: parseInt(row.total_clasificaciones || '0', 10),
                totalCitas: parseInt(row.total_citas || '0', 10),
                estadoSesion: row.estado_sesion,

                // Datos dinámicos del JSON (legacy)
                temperatura: json.temperatura || null,
                marca: json.marca || json.brand,
                tienda: json.tienda || json.store,
                departamento: json.departamento || json.department || row.ciudad,
                distrito: json.distrito || json.district,
                productos: json.producto || json.product,

                // Extras
                fechaCita: json.fecha_cita,
                fechaDerivacion: json.fecha_derivacion,
                tiempoDerivacion: json.tiempo_derivacion
            };
        });

        return {
            data: items,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Obtiene el detalle completo de un lead: clasificaciones y citas
     */
    async getDetalleLeadClasificacion(leadUuid: string) {
        this.logger.log(`Obteniendo detalle de lead: ${leadUuid}`);

        // 1. Obtener lead básico
        const lead = await this.leadRepo.findOne({
            where: { uuid: leadUuid }
        });

        if (!lead) {
            throw new NotFoundException(`Lead no encontrado: ${leadUuid}`);
        }

        // 2. Obtener prospecto(s) del lead
        const prospectos = await this.prospectoRepo.find({
            where: { idLead: lead.id }
        });

        // 3. Obtener sesión(es) del lead
        const sesiones = await this.sesionRepo.find({
            where: { leadUuid },
            order: { updatedAt: 'DESC' }
        });

        // 4. Obtener TODAS las clasificaciones (historial completo)
        const clasificaciones = await this.dataSource
            .createQueryBuilder()
            .select([
                'hcl.id as id',
                'hcl.clasificacion as clasificacion',
                'hcl.razon as razon',
                'hcl.fecha_creacion as fecha_creacion',
                'sc.id as sesion_id'
            ])
            .from('tbl_historial_clasificacion_lead', 'hcl')
            .innerJoin('tbl_sesion_conversacion', 'sc', 'sc.id = hcl.id_sesion')
            .where('sc.lead_uuid = :leadUuid', { leadUuid })
            .orderBy('hcl.fecha_creacion', 'DESC')
            .getRawMany();

        // 5. Obtener TODAS las citas
        const citas = await this.citaRepo.find({
            where: { leadUuid },
            order: { fechaCita: 'DESC', horaCita: 'DESC' }
        });

        // 6. Determinar estado actual
        const ultimaClasificacion = clasificaciones.length > 0 ? clasificaciones[0] : null;
        const estadoActual = ultimaClasificacion?.clasificacion || 'pendiente';

        return {
            success: true,
            data: {
                lead: {
                    id: lead.id,
                    uuid: lead.uuid,
                    nombre: lead.nombre,
                    apellido: lead.apellido,
                    telefono: lead.telefono,
                    email: lead.email,
                    dni: lead.dni,
                    fechaRegistro: lead.fechaRegistro
                },
                prospectos: prospectos.map(p => ({
                    id: p.id,
                    interesNombre: p.interesNombre,
                    origen: p.origenDato,
                    estadoGestion: p.estadoGestion,
                    fechaRegistro: p.fechaRegistro
                })),
                estadoActual,
                clasificaciones: clasificaciones.map(c => ({
                    id: c.id,
                    clasificacion: c.clasificacion,
                    razon: c.razon,
                    fecha: c.fecha_creacion
                })),
                citas: citas.map(c => ({
                    id: c.id,
                    fecha: c.fechaCita,
                    hora: c.horaCita,
                    tipo: c.tipoCita,
                    estado: c.estadoCita,
                    observacion: c.observacion,
                    fechaRegistro: c.fechaRegistro
                })),
                resumen: {
                    totalClasificaciones: clasificaciones.length,
                    totalCitas: citas.length,
                    citasPendientes: citas.filter(c => c.estadoCita === 'pendiente').length,
                    citasConfirmadas: citas.filter(c => c.estadoCita === 'confirmada').length,
                    citasRealizadas: citas.filter(c => c.estadoCita === 'realizada').length,
                    contenido: sesiones[0]?.resumenConversacion || null
                }
            }
        };
    }
}
