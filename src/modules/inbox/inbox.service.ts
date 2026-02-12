import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Mensaje } from './entities/mensaje.entity';
import { Lead } from './entities/lead.entity';
import { Prospecto } from './entities/prospecto.entity';
import { WapiService } from '../webhook_meta/wapi.service';
import { InboxGateway } from './inbox.gateway';

@Injectable()
export class InboxService {
    private readonly logger = new Logger(InboxService.name);

    constructor(
        @InjectRepository(Mensaje)
        private mensajeRepo: Repository<Mensaje>,
        @InjectRepository(Lead)
        private leadRepo: Repository<Lead>,
        @InjectRepository(Prospecto)
        private prospectoRepo: Repository<Prospecto>,
        private wapiService: WapiService,
        private inboxGateway: InboxGateway,
    ) { }

    async getConversaciones(codigoEmpresa: number, page: number = 1, limit: number = 50, filter: string = 'all', search: string = '') {
        try {
            const skip = (page - 1) * limit;

            // 1. Subquery to find the latest message ID for each conversation (most efficient grouping)
            const subQuery = this.mensajeRepo.createQueryBuilder('m_sub')
                .select('MAX(m_sub.id)', 'max_id')
                .where('m_sub.codigoEmpresa = :codigoEmpresa', { codigoEmpresa })
                .groupBy('m_sub.leadUuid');

            const query = this.mensajeRepo.createQueryBuilder('mensaje')
                .innerJoin(`(${subQuery.getQuery()})`, 'latest_msg', 'mensaje.id = latest_msg.max_id')
                .leftJoin('tbl_leads', 'lead', 'lead.uuid = mensaje.lead_uuid')
                .select([
                    'mensaje.lead_uuid AS leadUuid',
                    'lead.telefono AS numeroTelefono',
                    'COALESCE(lead.nombre, lead.nombre_meta) AS nombre',
                    'lead.apellido AS apellido',
                    'lead.email AS email',
                    'mensaje.contenido AS ultimoMensajeContenido',
                    'mensaje.fecha_creacion AS ultimaFecha',
                    'mensaje.id_emisor_tipo AS ultimoMensajeTipoEmisor',
                    'mensaje.tipo_multimedia AS ultimoMensajeTipoMultimedia',
                    'mensaje.url_multimedia AS ultimoMensajeUrlMultimedia',
                ])
                .addSelect(sub => {
                    return sub.select('p.estado_gestion', 'estadoGestion')
                        .from('tbl_prospectos', 'p')
                        .where('p.id_lead = lead.id_lead')
                        .andWhere('p.codigo_empresa = :codigoEmpresa')
                        .orderBy('p.fecha_actualizacion', 'DESC')
                        .limit(1);
                }, 'estadoGestion')
                .addSelect(sub => {
                    return sub.select('p.interes_nombre', 'interesNombre')
                        .from('tbl_prospectos', 'p')
                        .where('p.id_lead = lead.id_lead')
                        .andWhere('p.codigo_empresa = :codigoEmpresa')
                        .orderBy('p.fecha_actualizacion', 'DESC')
                        .limit(1);
                }, 'interesNombre')
                .addSelect(sub => {
                    return sub.select('COUNT(*)', 'noLeidos')
                        .from('tbl_mensajes', 'm_count')
                        .where('m_count.lead_uuid = mensaje.lead_uuid')
                        .andWhere('m_count.codigo_empresa = :codigoEmpresa')
                        .andWhere('m_count.leido = 0')
                        .andWhere('m_count.id_emisor_tipo IN (1, 2)'); // 1=Lead, 2=Bot
                }, 'noLeidos')
                .where('mensaje.codigoEmpresa = :codigoEmpresa', { codigoEmpresa })
                .setParameters(subQuery.getParameters());

            // 3. Apply Filters
            if (search) {
                query.andWhere(
                    '(lead.nombre LIKE :search OR lead.nombre_meta LIKE :search OR lead.apellido LIKE :search OR lead.telefono LIKE :search OR CONCAT(COALESCE(lead.nombre, lead.nombre_meta, \'\'), " ", COALESCE(lead.apellido, \'\')) LIKE :search)',
                    { search: `%${search}%` }
                );
            }

            if (filter === 'unread') {
                query.having('noLeidos > 0');
            }

            // 4. Execute Main Query
            const rawResults = await query
                .orderBy('mensaje.fecha_creacion', 'DESC')
                .offset(skip)
                .limit(limit)
                .getRawMany();

            this.logger.log(`Conversaciones encontradas (${filter}): ${rawResults.length}`);

            // 5. Calculate Total for Pagination
            const totalQuery = this.mensajeRepo.createQueryBuilder('m')
                .select('COUNT(DISTINCT m.leadUuid)', 'total')
                .leftJoin('tbl_leads', 'l', 'l.uuid = m.leadUuid')
                .where('m.codigoEmpresa = :codigoEmpresa', { codigoEmpresa });

            if (search) {
                totalQuery.andWhere(
                    '(l.nombre LIKE :search OR l.nombre_meta LIKE :search OR l.apellido LIKE :search OR l.telefono LIKE :search OR CONCAT(COALESCE(l.nombre, l.nombre_meta, \'\'), " ", COALESCE(l.apellido, \'\')) LIKE :search)',
                    { search: `%${search}%` }
                );
            }

            if (filter === 'unread') {
                totalQuery.andWhere('m.leido = 0 AND m.idEmisorTipo IN (1, 2)');
            }

            const totalResult = await totalQuery.getRawOne();
            const total = parseInt(totalResult?.total || 0);

            // 6. Map to DTO
            const conversations = rawResults.map(raw => ({
                leadUuid: raw.leadUuid,
                numeroTelefono: raw.numeroTelefono,
                nombreCompleto: `${raw.nombre || ''} ${raw.apellido || ''}`.trim() || 'Sin nombre',
                nombre: raw.nombre,
                apellido: raw.apellido,
                email: raw.email || '',
                estadoGestion: raw.estadoGestion || 'nuevo',
                interesNombre: raw.interesNombre || '',
                ultimoMensaje: {
                    contenido: raw.ultimoMensajeContenido || '',
                    fecha: raw.ultimaFecha,
                    tipoEmisor: raw.ultimoMensajeTipoEmisor,
                    tipoMultimedia: raw.ultimoMensajeTipoMultimedia,
                    urlMultimedia: raw.ultimoMensajeUrlMultimedia
                },
                mensajesNoLeidos: parseInt(raw.noLeidos) || 0,
                ultimaActividad: raw.ultimaFecha
            }));

            return {
                success: true,
                data: conversations,
                meta: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            this.logger.error(`Error en getConversaciones: ${error.message}`, error.stack);
            throw error;
        }
    }

    async getHistorialChat(leadUuid: string, codigoEmpresa: number, limit: number = 200) {
        try {
            this.logger.log(`getHistorialChat - Buscando mensajes para Lead: ${leadUuid}, Empresa: ${codigoEmpresa}, Limit: ${limit}`);

            // Use 'take' for limiting results, and order DESC properly
            const mensajes = await this.mensajeRepo.find({
                where: {
                    leadUuid,
                    codigoEmpresa
                },
                order: { fechaCreacion: 'DESC' },
                take: limit
            });

            mensajes.reverse();

            this.logger.log(`getHistorialChat - Encontrados ${mensajes.length} mensajes para lead ${leadUuid}`);

            const resultado = await this.mensajeRepo.update(
                {
                    leadUuid,
                    codigoEmpresa,
                    idEmisorTipo: In([1, 2]),
                    leido: 0
                },
                { leido: 1 }
            );

            // Si se marcaron mensajes como leídos, notificar actualización de conversaciones
            if (resultado.affected > 0) {
                this.logger.log(`${resultado.affected} mensajes marcados como leídos - Lead: ${leadUuid}`);
                // Delay para asegurar consistencia en DB antes de que otros clientes refresquen
                setTimeout(() => {
                    this.inboxGateway.notifyConversationsUpdate(codigoEmpresa);
                }, 300);
            }

            const mensajesAgrupados = this.agruparMensajesPorFecha(mensajes);

            return {
                success: true,
                data: mensajesAgrupados
            };
        } catch (error) {
            this.logger.error(`Error en getHistorialChat: ${error.message}`, error.stack);
            throw error;
        }
    }

    private agruparMensajesPorFecha(mensajes: Mensaje[]): any[] {
        const grupos = [];
        let fechaAnterior = null;

        mensajes.forEach((mensaje) => {
            const fechaMensaje = new Date(mensaje.fechaCreacion);
            const fechaStr = fechaMensaje.toDateString();

            if (fechaStr !== fechaAnterior) {
                grupos.push({
                    tipo: 'fecha',
                    fecha: mensaje.fechaCreacion,
                    etiqueta: this.obtenerEtiquetaFecha(mensaje.fechaCreacion)
                });
                fechaAnterior = fechaStr;
            }

            grupos.push({
                tipo: 'mensaje',
                id: mensaje.id,
                contenido: mensaje.contenido,
                fechaCreacion: mensaje.fechaCreacion,
                fechaEnvio: mensaje.fechaEnvio,
                fechaRecibido: mensaje.fechaRecibido,
                idEmisorTipo: mensaje.idEmisorTipo,
                tipoEmisor: this.getTipoEmisorNombre(mensaje.idEmisorTipo),
                urlMultimedia: mensaje.urlMultimedia,
                tipoMultimedia: mensaje.tipoMultimedia,
                estadoMensaje: mensaje.estadoMensaje,
                leido: mensaje.leido,
                wamidMsg: mensaje.wamidMsg
            });
        });

        return grupos;
    }

    private obtenerEtiquetaFecha(fecha: Date): string {
        const fechaMensaje = new Date(fecha);
        const hoy = new Date();
        const ayer = new Date(hoy);
        ayer.setDate(ayer.getDate() - 1);

        hoy.setHours(0, 0, 0, 0);
        ayer.setHours(0, 0, 0, 0);
        fechaMensaje.setHours(0, 0, 0, 0);

        if (fechaMensaje.getTime() === hoy.getTime()) {
            return 'Hoy';
        } else if (fechaMensaje.getTime() === ayer.getTime()) {
            return 'Ayer';
        } else {
            const opciones: Intl.DateTimeFormatOptions = {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            };
            return fechaMensaje.toLocaleDateString('es-ES', opciones);
        }
    }

    async marcarComoLeido(leadUuid: string, codigoEmpresa: number) {
        try {
            const resultado = await this.mensajeRepo.update(
                {
                    leadUuid,
                    codigoEmpresa,
                    idEmisorTipo: In([1, 2]), // Mensajes del prospecto (1) y Bot (2)
                    leido: 0
                },
                { leido: 1 }
            );

            if (resultado.affected > 0) {
                this.logger.log(`${resultado.affected} mensajes marcados como leídos - Lead: ${leadUuid}`);
                // Notificar actualización con un pequeño delay para asegurar consistencia en DB
                setTimeout(() => {
                    this.inboxGateway.notifyConversationsUpdate(codigoEmpresa);
                }, 300);
            }

            return {
                success: true,
                mensajesMarcados: resultado.affected
            };
        } catch (error) {
            this.logger.error(`Error en marcarComoLeido: ${error.message}`, error.stack);
            throw error;
        }
    }

    async enviarMensaje(dto: {
        leadUuid: string;
        codigoEmpresa: number;
        contenido: string;
        idUsuario?: number;
        tipoMultimedia?: string;
        urlMultimedia?: string;
    }) {
        try {
            const lead = await this.leadRepo.findOne({
                where: { uuid: dto.leadUuid, codigoEmpresa: dto.codigoEmpresa }
            });

            if (!lead) {
                return { success: false, message: 'Lead no encontrado' };
            }

            const nuevoMensaje = this.mensajeRepo.create({
                leadUuid: dto.leadUuid,
                codigoEmpresa: dto.codigoEmpresa,
                contenido: dto.contenido,
                idUsuario: dto.idUsuario,
                idEmisorTipo: 3,
                numeroTelefono: lead.telefono,
                fechaEnvio: new Date(),
                estadoMensaje: 'enviado',
                leido: 1,
                tipoMultimedia: dto.tipoMultimedia,
                urlMultimedia: dto.urlMultimedia
            });

            const mensajeGuardado = await this.mensajeRepo.save(nuevoMensaje);

            // Enviar mensaje por WhatsApp según el tipo
            try {
                const numeroCompleto = lead.telefono.startsWith('51') ? lead.telefono : `51${lead.telefono}`;
                let response: any = null;

                if (dto.tipoMultimedia && dto.urlMultimedia) {
                    // Convertir ruta relativa a absoluta
                    const rutaAbsoluta = dto.urlMultimedia.startsWith('/')
                        ? `.${dto.urlMultimedia}`
                        : dto.urlMultimedia;

                    switch (dto.tipoMultimedia) {
                        case 'image':
                            response = await this.wapiService.sendImage(dto.codigoEmpresa, numeroCompleto, rutaAbsoluta, dto.contenido);
                            break;
                        case 'document':
                        case 'application':
                            response = await this.wapiService.sendDocument(dto.codigoEmpresa, numeroCompleto, rutaAbsoluta, dto.contenido);
                            break;
                        case 'video':
                            response = await this.wapiService.sendVideo(dto.codigoEmpresa, numeroCompleto, rutaAbsoluta, dto.contenido);
                            break;
                        case 'audio':
                            response = await this.wapiService.sendAudio(dto.codigoEmpresa, numeroCompleto, rutaAbsoluta);
                            break;
                    }
                } else if (dto.contenido) {
                    // Enviar solo texto
                    response = await this.wapiService.sendMessage(dto.codigoEmpresa, numeroCompleto, dto.contenido);
                }

                this.logger.log(`Mensaje enviado por WhatsApp - Lead: ${dto.leadUuid}, Telefono: ${numeroCompleto}`);

                // Actualizar BD con resultado
                let nuevoEstado = 'enviado';
                let wamid = null;
                let errorDetails = null;

                if (response && response.error) {
                    nuevoEstado = 'fallido';
                    errorDetails = response.details;
                    this.logger.warn(`Error WAPI en InboxService: ${JSON.stringify(errorDetails)}`);
                } else {
                    wamid = response?.messages?.[0]?.id || response?.id || null;
                }

                await this.mensajeRepo.update(
                    { id: mensajeGuardado.id },
                    {
                        wamidMsg: wamid ? String(wamid) : null,
                        estadoMensaje: nuevoEstado,
                        errorWapi: errorDetails
                    }
                );

                // Actualizamos el objeto en memoria para devolverlo actualizado
                mensajeGuardado.estadoMensaje = nuevoEstado;
                mensajeGuardado.wamidMsg = wamid;
                mensajeGuardado.errorWapi = errorDetails;

            } catch (wapiError) {
                // Esto solo ocurriría si WapiService lanza una excepción no controlada
                this.logger.error(`Error crítico enviando por WhatsApp: ${wapiError.message}`, wapiError.stack);
                await this.mensajeRepo.update(
                    { id: mensajeGuardado.id },
                    { estadoMensaje: 'fallido', errorWapi: { message: wapiError.message, stack: wapiError.stack } }
                );
            }

            this.logger.log(`Mensaje guardado en BD - Lead: ${dto.leadUuid}, ID: ${mensajeGuardado.id}`);

            // Notificar a todos los usuarios conectados de la empresa en tiempo real
            this.inboxGateway.notifyNewMessage(dto.codigoEmpresa, dto.leadUuid, {
                tipo: 'mensaje',
                id: mensajeGuardado.id,
                contenido: mensajeGuardado.contenido,
                fechaCreacion: mensajeGuardado.fechaCreacion,
                fechaEnvio: mensajeGuardado.fechaEnvio,
                idEmisorTipo: mensajeGuardado.idEmisorTipo,
                tipoEmisor: this.getTipoEmisorNombre(mensajeGuardado.idEmisorTipo),
                urlMultimedia: mensajeGuardado.urlMultimedia,
                tipoMultimedia: mensajeGuardado.tipoMultimedia,
                estadoMensaje: mensajeGuardado.estadoMensaje,
                leido: mensajeGuardado.leido,
            });

            // Notificar actualización de conversaciones
            this.inboxGateway.notifyConversationsUpdate(dto.codigoEmpresa);

            return {
                success: true,
                data: mensajeGuardado
            };
        } catch (error) {
            this.logger.error(`Error en enviarMensaje: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Guardar mensaje enviado por el Bot (solo en BD, sin enviar por WhatsApp)
     * Se usa cuando el bot ya envió el mensaje por WhatsApp y solo necesitamos registrarlo
     */
    async guardarMensajeBot(dto: {
        leadUuid: string;
        codigoEmpresa: number;
        contenido: string;
        tipoMultimedia?: string;
        urlMultimedia?: string;
        wamid?: string;
        estadoMensaje?: string;
        errorWapi?: any;
    }) {
        try {
            const lead = await this.leadRepo.findOne({
                where: { uuid: dto.leadUuid, codigoEmpresa: dto.codigoEmpresa }
            });

            if (!lead) {
                this.logger.warn(`Lead no encontrado: ${dto.leadUuid}`);
                return { success: false, message: 'Lead no encontrado' };
            }

            const nuevoMensaje = this.mensajeRepo.create({
                leadUuid: dto.leadUuid,
                codigoEmpresa: dto.codigoEmpresa,
                contenido: dto.contenido,
                idEmisorTipo: 2, // Bot
                numeroTelefono: lead.telefono,
                fechaEnvio: new Date(),
                estadoMensaje: dto.estadoMensaje || 'enviado',
                leido: 1,
                tipoMultimedia: dto.tipoMultimedia,
                urlMultimedia: dto.urlMultimedia,
                wamidMsg: dto.wamid,
                errorWapi: dto.errorWapi
            });

            const mensajeGuardado = await this.mensajeRepo.save(nuevoMensaje);

            this.logger.log(`Mensaje Bot guardado en BD - Lead: ${dto.leadUuid}, ID: ${mensajeGuardado.id}`);

            // Notificar a todos los usuarios conectados de la empresa en tiempo real
            this.inboxGateway.notifyNewMessage(dto.codigoEmpresa, dto.leadUuid, {
                tipo: 'mensaje',
                id: mensajeGuardado.id,
                contenido: mensajeGuardado.contenido,
                fechaCreacion: mensajeGuardado.fechaCreacion,
                fechaEnvio: mensajeGuardado.fechaEnvio,
                idEmisorTipo: mensajeGuardado.idEmisorTipo,
                tipoEmisor: this.getTipoEmisorNombre(mensajeGuardado.idEmisorTipo),
                urlMultimedia: mensajeGuardado.urlMultimedia,
                tipoMultimedia: mensajeGuardado.tipoMultimedia,
                estadoMensaje: mensajeGuardado.estadoMensaje,
                leido: mensajeGuardado.leido,
            });

            // Notificar actualización de conversaciones
            this.inboxGateway.notifyConversationsUpdate(dto.codigoEmpresa);

            return {
                success: true,
                data: mensajeGuardado
            };
        } catch (error) {
            this.logger.error(`Error en guardarMensajeBot: ${error.message}`, error.stack);
            throw error;
        }
    }

    private getTipoEmisorNombre(idEmisorTipo: number): string {
        const tipos = {
            1: 'Prospecto',
            2: 'Bot',
            3: 'Asesor',
            4: 'Vendedor',
            5: 'Sistema'
        };
        return tipos[idEmisorTipo] || 'Desconocido';
    }
}
