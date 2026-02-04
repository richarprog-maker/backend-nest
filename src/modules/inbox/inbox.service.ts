import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

            const query = this.mensajeRepo
                .createQueryBuilder('mensaje')
                .select([
                    'mensaje.leadUuid AS leadUuid',
                    'lead.telefono AS numeroTelefono',
                    'MAX(mensaje.fechaCreacion) as ultimaFecha',
                    'COUNT(CASE WHEN mensaje.leido = 0 AND mensaje.idEmisorTipo = 1 THEN 1 END) as noLeidos',
                    'MAX(mensaje.contenido) as ultimoMensaje'
                ])
                .leftJoin(
                    Lead,
                    'lead',
                    'lead.uuid = mensaje.leadUuid'
                )
                .where('mensaje.codigoEmpresa = :codigoEmpresa', { codigoEmpresa })
                .groupBy('mensaje.leadUuid')
                .addGroupBy('lead.telefono');

            if (filter === 'unread') {
                query.having('noLeidos > 0');
            }

            if (search) {
                query.andWhere(
                    '(lead.nombre LIKE :search OR lead.apellido LIKE :search OR lead.telefono LIKE :search OR CONCAT(lead.nombre, " ", lead.apellido) LIKE :search)',
                    { search: `%${search}%` }
                );
            }

            const conversaciones = await query
                .orderBy('ultimaFecha', 'DESC')
                .offset(skip)
                .limit(limit)
                .getRawMany();

            this.logger.log(`Conversaciones encontradas (${filter}): ${conversaciones.length}`);

            const conversacionesConDetalles = await Promise.all(
                conversaciones.map(async (conv) => {
                    try {
                        const lead = await this.leadRepo.findOne({
                            where: { uuid: conv.leadUuid, codigoEmpresa }
                        });

                        const prospecto = lead ? await this.prospectoRepo.findOne({
                            where: { idLead: lead.id, codigoEmpresa },
                            order: { fechaActualizacion: 'DESC' }
                        }) : null;

                        const ultimoMensajeCompleto = await this.mensajeRepo.findOne({
                            where: {
                                leadUuid: conv.leadUuid,
                                codigoEmpresa
                            },
                            order: { fechaCreacion: 'DESC' }
                        });

                        const nombre = lead?.nombre || '';
                        const apellido = lead?.apellido || '';
                        const nombreCompleto = `${nombre} ${apellido}`.trim() || 'Sin nombre';

                        return {
                            leadUuid: conv.leadUuid,
                            numeroTelefono: conv.numeroTelefono,
                            nombreCompleto: nombreCompleto,
                            nombre: nombre,
                            apellido: apellido,
                            email: lead?.email || '',
                            estadoGestion: prospecto?.estadoGestion || 'nuevo',
                            interesNombre: prospecto?.interesNombre || '',
                            ultimoMensaje: {
                                contenido: ultimoMensajeCompleto?.contenido || '',
                                fecha: ultimoMensajeCompleto?.fechaCreacion,
                                tipoEmisor: ultimoMensajeCompleto?.idEmisorTipo,
                                tipoMultimedia: ultimoMensajeCompleto?.tipoMultimedia,
                                urlMultimedia: ultimoMensajeCompleto?.urlMultimedia
                            },
                            mensajesNoLeidos: parseInt(conv.noLeidos) || 0,
                            ultimaActividad: conv.ultimaFecha
                        };
                    } catch (error) {
                        this.logger.error(`Error procesando conversación ${conv.leadUuid}:`, error.message);
                        return null;
                    }
                })
            );

            const conversacionesValidas = conversacionesConDetalles.filter(c => c !== null);

            // Calcular total para paginación (respetando filtros)
            let total = 0;

            if (filter === 'unread') {
                // Contar cuántos leads tienen al menos un mensaje no leído
                const totalQuery = this.mensajeRepo
                    .createQueryBuilder('mensaje')
                    .select('COUNT(DISTINCT mensaje.leadUuid)', 'total')
                    .leftJoin(Lead, 'lead', 'lead.uuid = mensaje.leadUuid') // Correct join
                    .where('mensaje.codigoEmpresa = :codigoEmpresa', { codigoEmpresa })
                    .andWhere('mensaje.leido = 0')
                    .andWhere('mensaje.idEmisorTipo = 1'); // Solo mensajes de cliente

                if (search) {
                    totalQuery.andWhere(
                        '(lead.nombre LIKE :search OR lead.apellido LIKE :search OR lead.telefono LIKE :search OR CONCAT(lead.nombre, " ", lead.apellido) LIKE :search)',
                        { search: `%${search}%` }
                    );
                }

                const result = await totalQuery.getRawOne();
                total = parseInt(result.total) || 0;
            } else {
                const totalQuery = this.mensajeRepo
                    .createQueryBuilder('mensaje')
                    .select('COUNT(DISTINCT mensaje.leadUuid)', 'total')
                    .leftJoin(Lead, 'lead', 'lead.uuid = mensaje.leadUuid') // Correct join
                    .where('mensaje.codigoEmpresa = :codigoEmpresa', { codigoEmpresa });

                if (search) {
                    totalQuery.andWhere(
                        '(lead.nombre LIKE :search OR lead.apellido LIKE :search OR lead.telefono LIKE :search OR CONCAT(lead.nombre, " ", lead.apellido) LIKE :search)',
                        { search: `%${search}%` }
                    );
                }

                const result = await totalQuery.getRawOne();
                total = parseInt(result.total) || 0;
            }

            return {
                success: true,
                data: conversacionesValidas,
                meta: {
                    total: total,
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
            this.logger.log(`getHistorialChat - Buscando mensajes para Lead: ${leadUuid}, Empresa: ${codigoEmpresa}`);

            const mensajes = await this.mensajeRepo.find({
                where: {
                    leadUuid,
                    codigoEmpresa
                },
                order: { fechaCreacion: 'ASC' }
            });

            this.logger.log(`getHistorialChat - Encontrados ${mensajes.length} mensajes para lead ${leadUuid}`);

            // Marcar mensajes del prospecto como leídos
            const resultado = await this.mensajeRepo.update(
                {
                    leadUuid,
                    codigoEmpresa,
                    idEmisorTipo: 1, // Solo mensajes del prospecto
                    leido: 0
                },
                { leido: 1 }
            );

            // Si se marcaron mensajes como leídos, notificar actualización de conversaciones
            if (resultado.affected > 0) {
                this.logger.log(`${resultado.affected} mensajes marcados como leídos - Lead: ${leadUuid}`);
                this.inboxGateway.notifyConversationsUpdate(codigoEmpresa);
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
                    idEmisorTipo: 1, // Solo mensajes del prospecto
                    leido: 0
                },
                { leido: 1 }
            );

            if (resultado.affected > 0) {
                this.logger.log(`${resultado.affected} mensajes marcados como leídos - Lead: ${leadUuid}`);
                // Notificar actualización para que se actualice el contador
                this.inboxGateway.notifyConversationsUpdate(codigoEmpresa);
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
