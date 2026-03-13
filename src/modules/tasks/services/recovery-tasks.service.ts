
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';
import { PlantillaMensaje, TipoPlantilla } from '../../plantillas/entities/plantilla.entity';
import { WapiService } from '../../webhook_meta/wapi.service';
import { Lead } from '../../inbox/entities/lead.entity';
import { HistorialPlantillas } from '../../plantillas/entities/historial-plantilla.entity';
import { Mensaje } from '../../inbox/entities/mensaje.entity';
import { HistorialChatAi } from '../../ia/entities/historial-chat-ai.entity';
import { InboxGateway } from '../../inbox/inbox.gateway';
import { Proyecto } from '../../proyectos/entities/proyecto.entity';
import { TimeUtils } from '../../../common/utils/time.utils';

@Injectable()
export class RecoveryTasksService {
    private readonly logger = new Logger(RecoveryTasksService.name);
    private isRunning = false;

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
        @InjectRepository(Proyecto)
        private proyectoRepo: Repository<Proyecto>,
        @Inject(forwardRef(() => InboxGateway))
        private inboxGateway: InboxGateway,
        private wapiService: WapiService,
    ) { }

    @Cron(CronExpression.EVERY_MINUTE)
    async handleRecoveryMessages() {
        if (this.isRunning) {
            this.logger.debug('Recovery cron ya en ejecución. Saltando.');
            return;
        }

        if (!TimeUtils.isWithinOperatingHours()) {
            this.logger.debug('Fuera de horario operativo (10am-7pm). Cron pausado.');
            return;
        }

        this.isRunning = true;
        this.logger.log('Verificando sesiones para recuperación...');

        try {
            const sesiones = await this.sesionRepo.find({
                where: {
                    proximoMensajeMinutos: Not(0),
                    idEstado: 1,
                }
            });

            for (const sesion of sesiones) {
                await this.processSession(sesion);
            }

        } catch (error) {
            this.logger.error('Error en cron de recuperación', error);
        } finally {
            this.isRunning = false;
        }
    }

    private async processSession(sesion: SesionConversacion) {
        if (!sesion.fechaHoraUltimoMsj) return;

        if (sesion.idEstado !== 1) {
            this.logger.debug(`Sesion ${sesion.id} omitida: id_estado=${sesion.idEstado} (solo se procesan estado=1)`);
            return;
        }

        const now = new Date();
        const lastMsgTime = new Date(sesion.fechaHoraUltimoMsj);
        const diffMs = now.getTime() - lastMsgTime.getTime();
        const diffMinutes = Math.floor(diffMs / 60000);

        this.logger.debug(`Sesion ${sesion.id}: diff=${diffMinutes}m, target=${sesion.proximoMensajeMinutos}m`);

        if (diffMinutes >= sesion.proximoMensajeMinutos) {
            await this.sendRecoveryMessage(sesion);
        }
    }

    private async sendRecoveryMessage(sesion: SesionConversacion) {
        let tipoPlantilla: TipoPlantilla;
        let nextMinutes: number;

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
                nextMinutes = 0;
                break;
            default:
                this.logger.warn(`Sesion ${sesion.id} tiene proximoMensajeMinutos desconocido: ${sesion.proximoMensajeMinutos}`);
                return;
        }

        // 1. Obtener la plantilla
        const plantilla = await this.plantillaRepo.findOne({
            where: { tipo: tipoPlantilla, codigoEmpresa: sesion.codigoEmpresa }
        });

        if (!plantilla) {
            this.logger.warn(`No se encontró plantilla ${tipoPlantilla} para empresa ${sesion.codigoEmpresa}`);
            sesion.proximoMensajeMinutos = nextMinutes;
            await this.sesionRepo.save(sesion);
            return;
        }

        this.validarPlantillaRecuperacion(plantilla, tipoPlantilla);

        // 2. Obtener el Lead
        const lead = await this.leadRepo.findOne({ where: { uuid: sesion.leadUuid } });

        if (!lead || !lead.telefono) {
            this.logger.error(`Lead no encontrado o sin teléfono para sesión ${sesion.id} (UUID: ${sesion.leadUuid})`);
            sesion.proximoMensajeMinutos = 0;
            await this.sesionRepo.save(sesion);
            return;
        }

        // 3. Obtener datos del proyecto
        let nombreProyecto = 'Nuestro Proyecto';
        let direccionProyecto = '';
        if (sesion.proyectoId) {
            const proyecto = await this.proyectoRepo.findOne({ where: { id: sesion.proyectoId } });
            if (proyecto) {
                nombreProyecto = proyecto.nombre || nombreProyecto;
                direccionProyecto = proyecto.ubicacion || '';
            }
        }

        // Valores finales - idénticos entre lo que se envía a Meta y lo que se guarda en BD
        const nombreProyectoFinal = nombreProyecto;
        const direccionFinal = direccionProyecto ? `📍 ${direccionProyecto}` : '';

        // ANTI-DUPLICADOS: Actualizar estado ANTES de enviar
        sesion.proximoMensajeMinutos = nextMinutes;
        sesion.fechaHoraUltimoMsj = new Date();
        await this.sesionRepo.save(sesion);

        // 4. Construir componentes dinámicamente según parámetros de la plantilla
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
                            text: nombreProyectoFinal
                        });
                        break;
                    case 'direccion':
                        bodyParams.push({
                            type: 'text',
                            parameter_name: 'direccion',
                            text: direccionFinal || ' ' // Meta requiere string no vacío
                        });
                        break;
                }
            }

            if (bodyParams.length > 0) {
                components.push({ type: 'body', parameters: bodyParams });
            }
        }

        // 5. Reemplazar variables en contenido para guardar procesado
        let contenidoProcesado = plantilla.contenido;
        if (plantilla.parametros && Array.isArray(plantilla.parametros)) {
            for (const param of plantilla.parametros) {
                const regex = new RegExp(`\\{\\{${param}\\}\\}`, 'g');
                switch (param) {
                    case 'name':
                        contenidoProcesado = contenidoProcesado.replace(regex, (lead.nombre && lead.nombre.trim()) || 'Cliente');
                        break;
                    case 'project':
                        contenidoProcesado = contenidoProcesado.replace(regex, nombreProyectoFinal);
                        break;
                    case 'direccion':
                        contenidoProcesado = contenidoProcesado.replace(
                            new RegExp(`\\n.*\\{\\{${param}\\}\\}`, 'g'),
                            direccionFinal ? `\n${direccionFinal}` : ''
                        );
                        contenidoProcesado = contenidoProcesado.replace(regex, direccionFinal);
                        break;
                }
            }
        }

        // 6. Enviar plantilla
        this.logger.log(`[Recovery] Enviando como PLANTILLA (HSM): ${plantilla.nombre}`);
        const resultado = await this.wapiService.sendTemplate(
            sesion.codigoEmpresa,
            lead.telefono,
            plantilla.nombre,
            plantilla.idioma || 'es',
            components
        );

        // 7. Registrar historial
        const historial = new HistorialPlantillas();
        historial.leadUid = lead.id;
        historial.plantillaId = plantilla.id;
        historial.tipoMensaje = tipoPlantilla;
        historial.fechaEnvio = new Date();

        const esExito = resultado && !resultado.error && (resultado.messages || resultado.id);

        if (esExito) {
            this.logger.log(`Mensaje de recuperación (${tipoPlantilla}) enviado a ${lead.telefono}`);
            historial.estado = 'ENVIADO';
            historial.metadata = resultado;

            try {
                const wamid = resultado?.messages?.[0]?.id || resultado?.id || null;
                const nuevoMensaje = this.mensajeRepo.create({
                    codigoEmpresa: sesion.codigoEmpresa,
                    leadUuid: lead.uuid,
                    idUsuario: null,
                    idEmisorTipo: 2,
                    contenido: contenidoProcesado,
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

                const historialAi = this.historialAiRepo.create({
                    leadUuid: lead.uuid,
                    codigoEmpresa: sesion.codigoEmpresa,
                    input: { role: 'assistant', content: contenidoProcesado },
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

            try {
                const nuevoMensaje = this.mensajeRepo.create({
                    codigoEmpresa: sesion.codigoEmpresa,
                    leadUuid: lead.uuid,
                    idUsuario: null,
                    idEmisorTipo: 2,
                    contenido: contenidoProcesado,
                    numeroTelefono: lead.telefono,
                    tipoMultimedia: 'text',
                    estadoMensaje: 'fallido',
                    wamidMsg: null,
                    errorWapi: resultado,
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

    private validarPlantillaRecuperacion(plantilla: PlantillaMensaje, tipoPlantilla: TipoPlantilla) {
        const parametros = Array.isArray(plantilla.parametros) ? plantilla.parametros : [];
        if (!parametros.includes('project')) {
            this.logger.warn(
                `[Recovery] La plantilla ${tipoPlantilla} (${plantilla.nombre}) no declara el parametro "project".`
            );
            return;
        }

        if (!plantilla.contenido?.includes('{{project}}')) {
            this.logger.warn(
                `[Recovery] La plantilla ${tipoPlantilla} (${plantilla.nombre}) declara "project" pero su contenido local no usa {{project}}.`
            );
        }
    }
}
