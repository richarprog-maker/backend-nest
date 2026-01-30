import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, Between, LessThan, MoreThan, In } from 'typeorm';
import { Cita } from '../../citas/entities/cita.entity';
import { PlantillaMensaje, TipoPlantilla } from '../../plantillas/entities/plantilla.entity';
import { WapiService } from '../../webhook_meta/wapi.service';
import { Lead } from '../../inbox/entities/lead.entity';
import { HistorialPlantillas } from '../../plantillas/entities/historial-plantilla.entity';
import { Mensaje } from '../../inbox/entities/mensaje.entity';
import { HistorialChatAi } from '../../ia/entities/historial-chat-ai.entity';
import { InboxGateway } from '../../inbox/inbox.gateway';

@Injectable()
export class RecordatorioCitasService {
    private readonly logger = new Logger(RecordatorioCitasService.name);

    // Nombres de plantillas (Deben coincidir con DB)
    private readonly TEMPLATE_24H = 'recordatorio_cita_24horas_virtual_lirios';
    private readonly TEMPLATE_3H = 'recordatorio_cita_3horas_virtual_lirios';
    private readonly TEMPLATE_30MIN = 'recordatorio_cita_30min_virtual_lirios';

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
        @Inject(forwardRef(() => InboxGateway))
        private inboxGateway: InboxGateway,
        private wapiService: WapiService,
    ) { }

    @Cron(CronExpression.EVERY_MINUTE)
    async handleAppointmentReminders() {
        this.logger.log('Verificando recordatorios de citas...');
        try {
            // Buscamos citas PENDIENTES o CONFIRMADAS
            const citas = await this.citaRepo.find({
                where: {
                    estadoCita: In(['pendiente', 'confirmada'])
                }
            });

            const now = new Date();

            for (const cita of citas) {
                // Combinar fecha y hora para tener un objeto Date completo
                const fechaStr = cita.fechaCita;
                const horaStr = cita.horaCita;
                if (!fechaStr || !horaStr) continue;

                const citaDate = new Date(`${fechaStr}T${horaStr}`); // Cuidado con la zona horaria, asumimos server time = local time para simplificar o UTC correcto

                // Calcular diferencia en minutos
                const diffMs = citaDate.getTime() - now.getTime();
                const diffMinutes = Math.floor(diffMs / 60000);

                // Si la diferencia es negativa, la cita ya pasó
                if (diffMinutes < 0) continue;

                // LOGICA DE RECORDATORIOS
                // 24 HORAS (1440 min)
                // Rango aceptable: entre 1435 y 1445
                if (diffMinutes >= 1435 && diffMinutes <= 1445) {
                    await this.sendReminder(cita, this.TEMPLATE_24H, TipoPlantilla.RECORDATORIO_CITA_24H);
                }

                // 3 HORAS (180 min)
                if (diffMinutes >= 175 && diffMinutes <= 185) {
                    await this.sendReminder(cita, this.TEMPLATE_3H, TipoPlantilla.RECORDATORIO_CITA_3H);
                }

                // 30 MINUTOS
                if (diffMinutes >= 25 && diffMinutes <= 35) {
                    await this.sendReminder(cita, this.TEMPLATE_30MIN, TipoPlantilla.RECORDATORIO_CITA_30MIN);
                }
            }

        } catch (error) {
            this.logger.error('Error en cron de recordatorios de citas', error);
        }
    }

    private async sendReminder(cita: Cita, templateName: string, logicalType: TipoPlantilla) {
        // Verificar si ya se envió este recordatorio de este TIPO LOGICO
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        let leadId: number = 0;
        let leadUuid: string = cita.leadUuid;

        const lead = await this.leadRepo.findOne({ where: { uuid: leadUuid } });
        if (!lead) {
            this.logger.warn(`Lead no encontrado para cita ${cita.id}`);
            return;
        }
        leadId = lead.id;

        const yaEnviado = await this.historialRepo.findOne({
            where: {
                leadUid: leadId,
                tipoMensaje: logicalType,
                fechaEnvio: MoreThan(oneHourAgo)
            }
        });

        if (yaEnviado) {
            return;
        }

        // Obtener Plantilla por NOMBRE
        const plantilla = await this.plantillaRepo.findOne({
            where: {
                nombre: templateName,
                codigoEmpresa: cita.codigoEmpresa
            }
        });

        if (!plantilla) {
            this.logger.warn(`Plantilla ${templateName} no encontrada para cita ${cita.id}`);
            return;
        }

        // Reemplazar parámetros
        let contenido = plantilla.contenido;
        // Nombre
        if (plantilla.parametros && plantilla.parametros.includes('name')) {
            const nombre = lead.nombre || 'Cliente';
            contenido = contenido.replace('{{name}}', nombre);
        }
        // Hora
        if (plantilla.parametros && plantilla.parametros.includes('hora')) {
            const horaSimple = cita.horaCita.substring(0, 5);
            contenido = contenido.replace('{{hora}}', horaSimple);
        }

        // ENVIAR
        this.logger.log(`Enviando recordatorio ${logicalType} a ${lead.telefono}`);
        const resultado = await this.wapiService.sendMessage(cita.codigoEmpresa, lead.telefono, contenido);

        // REGISTRAR HISTORIAL con el TIPO LOGICO
        await this.logHistory(lead, cita.codigoEmpresa, logicalType, plantilla.id, contenido, resultado);
    }

    private async logHistory(lead: Lead, codigoEmpresa: number, tipo: TipoPlantilla, plantillaId: number, contenido: string, resultado: any) {

        // 1. Historial Plantillas
        const historial = new HistorialPlantillas();
        historial.leadUid = lead.id;
        historial.plantillaId = plantillaId;
        historial.tipoMensaje = tipo;
        historial.fechaEnvio = new Date();

        let wamid = null;
        let estado = 'FALLIDO';

        if (resultado && !resultado.error) {
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

        // 2. Tbl Mensajes & WebSocket
        try {
            const nuevoMensaje = this.mensajeRepo.create({
                codigoEmpresa: codigoEmpresa,
                leadUuid: lead.uuid,
                idUsuario: null,
                idEmisorTipo: 2, // Bot
                contenido: contenido,
                numeroTelefono: lead.telefono,
                tipoMultimedia: 'text',
                estadoMensaje: estado,
                wamidMsg: wamid ? String(wamid) : null,
                errorWapi: resultado?.error || null,
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

            // 3. Historial Chat AI
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
