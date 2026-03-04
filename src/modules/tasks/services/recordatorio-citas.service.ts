import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThan } from 'typeorm';
import { Cita } from '../../citas/entities/cita.entity';
import { PlantillaMensaje, TipoPlantilla } from '../../plantillas/entities/plantilla.entity';
import { WapiService } from '../../webhook_meta/wapi.service';
import { Lead } from '../../inbox/entities/lead.entity';
import { HistorialPlantillas } from '../../plantillas/entities/historial-plantilla.entity';
import { Mensaje } from '../../inbox/entities/mensaje.entity';
import { HistorialChatAi } from '../../ia/entities/historial-chat-ai.entity';
import { InboxGateway } from '../../inbox/inbox.gateway';
import { Proyecto } from '../../proyectos/entities/proyecto.entity';

@Injectable()
export class RecordatorioCitasService {
    private readonly logger = new Logger(RecordatorioCitasService.name);

    // Nombres de plantillas VIRTUAL
    private readonly TEMPLATE_24H_VIRTUAL = 'recordatorio_cita_24horas_virtual_2';
    private readonly TEMPLATE_3H_VIRTUAL = 'recordatorio_cita_3horas_virtual_2';
    private readonly TEMPLATE_30MIN_VIRTUAL = 'recordatorio_cita_30min_virtual_2';

    // Nombres de plantillas PRESENCIAL
    private readonly TEMPLATE_24H_PRESENCIAL = 'recordatorio_cita_24horas2';
    private readonly TEMPLATE_3H_PRESENCIAL = 'recordatorio_cita_3horas2';
    private readonly TEMPLATE_30MIN_PRESENCIAL = 'recordatorio_cita_30min2';

    constructor(
        @InjectRepository(Cita)
        private citaRepo: Repository<Cita>,
        @InjectRepository(PlantillaMensaje)
        private plantillaRepo: Repository<PlantillaMensaje>,
        @InjectRepository(Lead)
        private leadRepo: Repository<Lead>,
        @InjectRepository(HistorialPlantillas)
        private historialRepo: Repository<HistorialPlantillas>,
        @InjectRepository(Mensaje)
        private mensajeRepo: Repository<Mensaje>,
        @InjectRepository(HistorialChatAi)
        private historialAiRepo: Repository<HistorialChatAi>,
        @InjectRepository(Proyecto)
        private proyectoRepo: Repository<Proyecto>,
        @Inject(forwardRef(() => InboxGateway))
        private inboxGateway: InboxGateway,
        private wapiService: WapiService,
    ) { }

    @Cron(CronExpression.EVERY_MINUTE)
    async handleAppointmentReminders() {
        this.logger.log('Verificando recordatorios de citas...');
        try {
            const citas = await this.citaRepo.find({
                where: {
                    estadoCita: In(['pendiente', 'confirmada'])
                }
            });

            const now = new Date();

            for (const cita of citas) {
                const fechaStr = cita.fechaCita;
                const horaStr = cita.horaCita;
                if (!fechaStr || !horaStr) continue;

                const citaDate = new Date(`${fechaStr}T${horaStr}`);
                const diffMs = citaDate.getTime() - now.getTime();
                const diffMinutes = Math.floor(diffMs / 60000);

                if (diffMinutes < 0) continue;

                const isVirtual = cita.tipoCita?.toUpperCase() === 'VIRTUAL';

                // 24 HORAS (1440 min) - Rango aceptable: 1435..1445
                if (diffMinutes >= 1435 && diffMinutes <= 1445) {
                    const templateName = isVirtual ? this.TEMPLATE_24H_VIRTUAL : this.TEMPLATE_24H_PRESENCIAL;
                    await this.sendReminder(cita, templateName, TipoPlantilla.RECORDATORIO_CITA_24H);
                }

                // 3 HORAS (180 min) - Rango: 175..185
                if (diffMinutes >= 175 && diffMinutes <= 185) {
                    const templateName = isVirtual ? this.TEMPLATE_3H_VIRTUAL : this.TEMPLATE_3H_PRESENCIAL;
                    await this.sendReminder(cita, templateName, TipoPlantilla.RECORDATORIO_CITA_3H);
                }

                // 30 MINUTOS - Rango: 25..35
                if (diffMinutes >= 25 && diffMinutes <= 35) {
                    const templateName = isVirtual ? this.TEMPLATE_30MIN_VIRTUAL : this.TEMPLATE_30MIN_PRESENCIAL;
                    await this.sendReminder(cita, templateName, TipoPlantilla.RECORDATORIO_CITA_30MIN);
                }
            }

        } catch (error) {
            this.logger.error('Error en cron de recordatorios de citas', error);
        }
    }

    private async sendReminder(cita: Cita, templateName: string, logicalType: TipoPlantilla) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const lead = await this.leadRepo.findOne({ where: { uuid: cita.leadUuid } });
        if (!lead) {
            this.logger.warn(`Lead no encontrado para cita ${cita.id}`);
            return;
        }

        const yaEnviado = await this.historialRepo.findOne({
            where: {
                leadUid: lead.id,
                tipoMensaje: logicalType,
                fechaEnvio: MoreThan(oneHourAgo)
            }
        });
        if (yaEnviado) return;

        // Obtener datos del proyecto
        let nombreProyecto = cita.nombreProyecto || 'Nuestro Proyecto';
        let direccionProyecto = '';

        if (cita.proyectoId) {
            const proyecto = await this.proyectoRepo.findOne({ where: { id: cita.proyectoId } });
            if (proyecto) {
                nombreProyecto = proyecto.nombre || nombreProyecto;
                direccionProyecto = proyecto.ubicacion || '';
            }
        }

        // Obtener plantilla
        const plantilla = await this.plantillaRepo.findOne({
            where: { nombre: templateName, codigoEmpresa: cita.codigoEmpresa }
        });

        if (!plantilla) {
            this.logger.warn(`Plantilla ${templateName} no encontrada para cita ${cita.id}`);
            return;
        }

        // Construir componentes dinámicamente según parámetros de la plantilla
        const components = [];
        if (plantilla.parametros && Array.isArray(plantilla.parametros) && plantilla.parametros.length > 0) {
            const bodyParams = [];

            for (const param of plantilla.parametros) {
                switch (param) {
                    case 'name':
                        bodyParams.push({
                            type: 'text',
                            parameter_name: 'name',
                            text: (lead.nombre && lead.nombre.trim()) || 'Cliente'
                        });
                        break;
                    case 'project':
                        bodyParams.push({
                            type: 'text',
                            parameter_name: 'project',
                            text: nombreProyecto
                        });
                        break;
                    case 'hora':
                        bodyParams.push({
                            type: 'text',
                            parameter_name: 'hora',
                            text: cita.horaCita.substring(0, 5)
                        });
                        break;
                    case 'direccion':
                        bodyParams.push({
                            type: 'text',
                            parameter_name: 'direccion',
                            text: direccionProyecto || 'Por confirmar'
                        });
                        break;
                }
            }

            if (bodyParams.length > 0) {
                components.push({ type: 'body', parameters: bodyParams });
            }
        }

        this.logger.debug(`Componentes preparados para cita ${cita.id}: ${JSON.stringify(components)}`);
        this.logger.log(`Enviando recordatorio ${logicalType} a ${lead.telefono} usando Plantilla: ${plantilla.nombre}`);

        const resultado = await this.wapiService.sendTemplate(
            cita.codigoEmpresa,
            lead.telefono,
            plantilla.nombre,
            plantilla.idioma || 'es',
            components
        );

        // Reemplazar variables en el contenido para guardarlo procesado
        let contenidoProcesado = plantilla.contenido;
        if (plantilla.parametros && Array.isArray(plantilla.parametros)) {
            for (const param of plantilla.parametros) {
                const regex = new RegExp(`\\{\\{${param}\\}\\}`, 'g');
                switch (param) {
                    case 'name':
                        contenidoProcesado = contenidoProcesado.replace(regex, (lead.nombre && lead.nombre.trim()) || 'Cliente');
                        break;
                    case 'project':
                        contenidoProcesado = contenidoProcesado.replace(regex, nombreProyecto);
                        break;
                    case 'hora':
                        contenidoProcesado = contenidoProcesado.replace(regex, cita.horaCita.substring(0, 5));
                        break;
                    case 'direccion':
                        contenidoProcesado = contenidoProcesado.replace(regex, direccionProyecto || 'Por confirmar');
                        break;
                }
            }
        }

        await this.logHistory(lead, cita.codigoEmpresa, logicalType, plantilla.id, contenidoProcesado, resultado);
    }

    private async logHistory(lead: Lead, codigoEmpresa: number, tipo: TipoPlantilla, plantillaId: number, contenido: string, resultado: any) {
        const historial = new HistorialPlantillas();
        historial.leadUid = lead.id;
        historial.plantillaId = plantillaId;
        historial.tipoMensaje = tipo;
        historial.fechaEnvio = new Date();

        let wamid = null;
        let estado = 'FALLIDO';

        if (resultado && !resultado.error && (resultado.messages || resultado.id)) {
            historial.estado = 'ENVIADO';
            historial.metadata = resultado;
            estado = 'enviado';
            wamid = resultado?.messages?.[0]?.id || resultado?.id;
        } else {
            historial.estado = 'FALLIDO';
            historial.metadata = resultado;
            estado = 'fallido';
        }
        await this.historialRepo.save(historial);

        try {
            const errorData = resultado?.error ? (resultado.details || resultado) : null;

            const nuevoMensaje = this.mensajeRepo.create({
                codigoEmpresa: codigoEmpresa,
                leadUuid: lead.uuid,
                idUsuario: null,
                idEmisorTipo: 2,
                contenido: contenido,
                numeroTelefono: lead.telefono,
                tipoMultimedia: 'text',
                estadoMensaje: estado,
                wamidMsg: wamid ? String(wamid) : null,
                errorWapi: errorData,
                leido: 0,
                conversacionFacturable: 0,
                fechaEnvio: new Date(),
                fechaCreacion: new Date()
            });
            await this.mensajeRepo.save(nuevoMensaje);

            this.inboxGateway.notifyNewMessage(codigoEmpresa, lead.uuid, {
                tipo: 'mensaje',
                id: nuevoMensaje.id,
                contenido: nuevoMensaje.contenido,
                fechaCreacion: nuevoMensaje.fechaCreacion,
                fechaEnvio: nuevoMensaje.fechaEnvio,
                idEmisorTipo: nuevoMensaje.idEmisorTipo,
                tipoEmisor: 'Bot',
                urlMultimedia: null,
                tipoMultimedia: null,
                estadoMensaje: nuevoMensaje.estadoMensaje,
                leido: nuevoMensaje.leido,
            });
            this.inboxGateway.notifyConversationsUpdate(codigoEmpresa);

            const historialAi = this.historialAiRepo.create({
                leadUuid: lead.uuid,
                codigoEmpresa: codigoEmpresa,
                input: { role: 'assistant', content: contenido },
                role: 'assistant',
                nombreModelo: 'appointment-system',
                metadatos: {
                    origen: 'appointment_reminder',
                    tipo_recordatorio: tipo
                }
            });
            await this.historialAiRepo.save(historialAi);

        } catch (e) {
            this.logger.error('Error registrando mensaje en recordatorio', e);
        }
    }
}
