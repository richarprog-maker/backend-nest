
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';
import { PlantillaMensaje, TipoPlantilla } from '../../plantillas/entities/plantilla.entity';
import { WapiService } from '../../webhook_meta/wapi.service';
import { Lead } from '../../inbox/entities/lead.entity';
import { HistorialPlantillas } from '../../plantillas/entities/historial-plantilla.entity';
import { Mensaje } from '../../inbox/entities/mensaje.entity';
import { HistorialChatAi } from '../../ia/entities/historial-chat-ai.entity';
import { InboxGateway } from '../../inbox/inbox.gateway';
import { TimeUtils } from '../../../common/utils/time.utils';

@Injectable()
export class RecoveryTasksService {
    private readonly logger = new Logger(RecoveryTasksService.name);

    // Constantes de tiempo (en minutos) - VALORES DE PRODUCCIÓN
    // 1 hora = 60 minutos
    // 8 horas = 480 minutos
    // 24 horas = 1440 minutos
    private readonly TIEMPO_1H = 60;
    private readonly TIEMPO_8H = 480;
    private readonly TIEMPO_24H = 1440;

    constructor(
        @InjectRepository(SesionConversacion)
        private sesionRepo: Repository<SesionConversacion>,
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
    async handleRecoveryMessages() {
        // VALIDACION DE HORARIO (BLOCKING)
        if (!TimeUtils.isWithinOperatingHours()) {
            this.logger.debug('Fuera de horario operativo (10am-7pm). Cron pausado.');
            return;
        }

        this.logger.log('Verificando sesiones para recuperación...');

        try {
            // Buscar sesiones que tienen un próximo mensaje programado
            // SOLO si id_estado = 1 (activo), NO enviar si id_estado = 2
            const sesiones = await this.sesionRepo.find({
                where: {
                    proximoMensajeMinutos: Not(0), // 0 significa que ya terminó el ciclo o no aplica
                    idEstado: 1, // SOLO sesiones activas (estado 1)
                }
            });

            for (const sesion of sesiones) {
                await this.processSession(sesion);
            }

        } catch (error) {
            this.logger.error('Error en cron de recuperación', error);
        }
    }

    private async processSession(sesion: SesionConversacion) {
        if (!sesion.fechaHoraUltimoMsj) return;

        // VALIDACIÓN: Solo procesar si id_estado = 1 (activo)
        if (sesion.idEstado !== 1) {
            this.logger.debug(`Sesion ${sesion.id} omitida: id_estado=${sesion.idEstado} (solo se procesan estado=1)`);
            return;
        }

        const now = new Date();
        const lastMsgTime = new Date(sesion.fechaHoraUltimoMsj);

        // Calcular diferencia en minutos
        const diffMs = now.getTime() - lastMsgTime.getTime();
        const diffMinutes = Math.floor(diffMs / 60000);

        this.logger.debug(`Sesion ${sesion.id}: diff=${diffMinutes}m, target=${sesion.proximoMensajeMinutos}m`);

        // Verificar si ya pasó el tiempo programado
        if (diffMinutes >= sesion.proximoMensajeMinutos) {
            await this.sendRecoveryMessage(sesion);
        }
    }

    private async sendRecoveryMessage(sesion: SesionConversacion) {
        let tipoPlantilla: TipoPlantilla;
        let nextMinutes: number;

        // Determinar qué plantilla enviar y cuál es el siguiente paso
        switch (sesion.proximoMensajeMinutos) {
            case this.TIEMPO_1H:
                tipoPlantilla = TipoPlantilla.RECUPERACION_1H;
                nextMinutes = this.TIEMPO_8H;
                break;
            case this.TIEMPO_8H:
                tipoPlantilla = TipoPlantilla.RECUPERACION_8H;
                nextMinutes = this.TIEMPO_24H;
                break;
            case this.TIEMPO_24H:
                tipoPlantilla = TipoPlantilla.RECUPERACION_24H;
                nextMinutes = 0; // Fin del ciclo
                break;
            default:
                // Si tiene un valor extraño, lo reseteamos o ignoramos
                this.logger.warn(`Sesion ${sesion.id} tiene proximoMensajeMinutos desconocido: ${sesion.proximoMensajeMinutos}`);
                return;
        }

        // 1. Obtener la plantilla
        const plantilla = await this.plantillaRepo.findOne({
            where: {
                tipo: tipoPlantilla,
                codigoEmpresa: sesion.codigoEmpresa
            }
        });

        if (!plantilla) {
            this.logger.warn(`No se encontró plantilla ${tipoPlantilla} para empresa ${sesion.codigoEmpresa}`);
            // Avanzamos al siguiente estado para evitar bucle infinito
            sesion.proximoMensajeMinutos = nextMinutes;
            await this.sesionRepo.save(sesion);
            return;
        }

        // 2. Obtener el Lead para el teléfono
        // Hacemos el "join" manual buscando por uuid
        const lead = await this.leadRepo.findOne({
            where: { uuid: sesion.leadUuid }
        });

        if (!lead || !lead.telefono) {
            this.logger.error(`Lead no encontrado o sin teléfono para sesión ${sesion.id} (UUID: ${sesion.leadUuid})`);
            sesion.proximoMensajeMinutos = 0;
            await this.sesionRepo.save(sesion);
            return;
        }

        // 3. Enviar Mensaje
        const contenido = plantilla.contenido;
        const resultado = await this.wapiService.sendMessage(sesion.codigoEmpresa, lead.telefono, contenido);

        // 4. Registrar en historial
        const historial = new HistorialPlantillas();
        historial.leadUid = lead.id;
        historial.plantillaId = plantilla.id;
        historial.tipoMensaje = tipoPlantilla;
        historial.fechaEnvio = new Date();

        if (resultado && !resultado.error) {
            this.logger.log(`Mensaje de recuperación (${tipoPlantilla}) enviado a ${lead.telefono}`);

            historial.estado = 'ENVIADO';
            historial.metadata = resultado;

            // Actualizar estado para la siguiente recuperación
            sesion.proximoMensajeMinutos = nextMinutes;

            // ACTULIZAMOS la fecha de último mensaje
            sesion.fechaHoraUltimoMsj = new Date();

            await this.sesionRepo.save(sesion);

            // LOGICA DE REGISTRO EN TBL_MENSAJES
            try {
                const wamid = resultado?.messages?.[0]?.id || resultado?.id || null;
                const nuevoMensaje = this.mensajeRepo.create({
                    codigoEmpresa: sesion.codigoEmpresa,
                    leadUuid: lead.uuid,
                    idUsuario: null, // Bot/Sistema
                    idEmisorTipo: 2, // 2 = Bot
                    contenido: contenido,
                    numeroTelefono: lead.telefono,
                    tipoMultimedia: 'text',
                    estadoMensaje: 'enviado',
                    wamidMsg: wamid ? String(wamid) : null,
                    errorWapi: null,
                    leido: 0,
                    conversacionFacturable: 0,
                    fechaEnvio: new Date(),
                    fechaCreacion: new Date()
                });
                await this.mensajeRepo.save(nuevoMensaje);
                this.logger.debug(`[Recovery] Mensaje guardado en BD. ID: ${nuevoMensaje.id}`);

                // NOTIFICAR POR WEBSOCKET (Real-Time)
                this.inboxGateway.notifyNewMessage(sesion.codigoEmpresa, lead.uuid, {
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

                this.inboxGateway.notifyConversationsUpdate(sesion.codigoEmpresa);

                // LOGICA DE REGISTRO EN HISTORIAL_CHAT_AI
                const historialAi = this.historialAiRepo.create({
                    leadUuid: lead.uuid,
                    codigoEmpresa: sesion.codigoEmpresa,
                    input: { role: 'assistant', content: contenido },
                    role: 'assistant',
                    nombreModelo: 'recovery-system',
                    metadatos: {
                        origen: 'recovery_task',
                        wamid: wamid,
                        mensaje_id: nuevoMensaje.id,
                        tipo_plantilla: tipoPlantilla
                    }
                });
                await this.historialAiRepo.save(historialAi);
                this.logger.debug(`[Recovery] Contexto AI guardado.`);

            } catch (logError) {
                this.logger.error('Error registrando mensaje/chat en base de datos', logError);
            }

        } else {
            this.logger.error(`Error enviando recuperación a ${lead.telefono}: ${JSON.stringify(resultado)}`);

            historial.estado = 'FALLIDO';
            historial.metadata = resultado;

            // Registrar fallo en tbl_mensajes tambien? User pidio registrar "una vez que se envia".
            // Si falla, el usuario pidio "error_wapi json". Asi que registraremos el fallo.
            try {
                const nuevoMensaje = this.mensajeRepo.create({
                    codigoEmpresa: sesion.codigoEmpresa,
                    leadUuid: lead.uuid,
                    idUsuario: null,
                    idEmisorTipo: 2,
                    contenido: contenido,
                    numeroTelefono: lead.telefono,
                    tipoMultimedia: 'text',
                    estadoMensaje: 'fallido',
                    wamidMsg: null,
                    errorWapi: resultado, // Guardamos el error
                    leido: 0,
                    conversacionFacturable: 0,
                    fechaEnvio: new Date(),
                    fechaCreacion: new Date()
                });
                await this.mensajeRepo.save(nuevoMensaje);
            } catch (logError) {
                this.logger.error('Error registrando mensaje fallido', logError);
            }
        }

        try {
            await this.historialRepo.save(historial);
        } catch (e) {
            this.logger.error('Error guardando historial de plantilla', e);
        }
    }
}
