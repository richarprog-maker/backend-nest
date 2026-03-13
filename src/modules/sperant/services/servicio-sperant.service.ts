import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { Lead } from '../../inbox/entities/lead.entity';
import { Prospecto } from '../../inbox/entities/prospecto.entity';
import { OrigenDato } from '../../inbox/entities/origen-dato.entity';
import { Mensaje } from '../../inbox/entities/mensaje.entity';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';
import { HistorialChatAi } from '../../ia/entities/historial-chat-ai.entity';
import { PlantillaMensaje, TipoPlantilla } from '../../plantillas/entities/plantilla.entity';
import { HistorialEnviosService } from '../../historial-envios/services/historial-envios.service';
import { PlantillasService } from '../../plantillas/services/plantillas.service';
import { WapiService } from '../../webhook_meta/wapi.service';
import { Cita } from '../../citas/entities/cita.entity';
import { Proyecto } from '../../proyectos/entities/proyecto.entity';
import { UnidadProyecto } from '../../proyectos/entities/unidad-proyecto.entity';
import { EventoWebhookSperant } from '../entities/evento-webhook-sperant.entity';
import { MapeoContactoSperant } from '../entities/mapeo-contacto-sperant.entity';
import { SincronizacionCitaSperant } from '../entities/sincronizacion-cita-sperant.entity';
import { SincronizacionProformaSperant } from '../entities/sincronizacion-proforma-sperant.entity';
import { ServicioApiSperantService } from './servicio-api-sperant.service';
import { ServicioProyectosSperantService } from './servicio-proyectos-sperant.service';

type LeadSperantNormalizado = {
    evento: 'client_created' | 'client_digital';
    clienteIdSperant: number;
    creadoEn?: string | null;
    nombre?: string | null;
    apellido?: string | null;
    documento?: string | null;
    tipoDocumento?: string | null;
    telefono?: string | null;
    email?: string | null;
    genero?: string | null;
    observacion?: string | null;
    ultimaInteraccionAt?: string | null;
    proyectoIdSperant?: number | null;
    interesNombre?: string | null;
    medioCaptacion?: string | null;
    canalEntrada?: string | null;
    sellerId?: number | null;
    payload: any;
};

@Injectable()
export class ServicioSperantService {
    private readonly logger = new Logger(ServicioSperantService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly configService: ConfigService,
        private readonly servicioApiSperant: ServicioApiSperantService,
        private readonly servicioProyectosSperant: ServicioProyectosSperantService,
        private readonly plantillasService: PlantillasService,
        private readonly historialEnviosService: HistorialEnviosService,
        private readonly wapiService: WapiService,
        @InjectRepository(EventoWebhookSperant)
        private readonly eventoWebhookRepo: Repository<EventoWebhookSperant>,
        @InjectRepository(MapeoContactoSperant)
        private readonly mapeoContactoRepo: Repository<MapeoContactoSperant>,
        @InjectRepository(SincronizacionCitaSperant)
        private readonly syncCitaRepo: Repository<SincronizacionCitaSperant>,
        @InjectRepository(SincronizacionProformaSperant)
        private readonly syncProformaRepo: Repository<SincronizacionProformaSperant>,
        @InjectRepository(Lead)
        private readonly leadRepo: Repository<Lead>,
        @InjectRepository(Prospecto)
        private readonly prospectoRepo: Repository<Prospecto>,
        @InjectRepository(OrigenDato)
        private readonly origenRepo: Repository<OrigenDato>,
        @InjectRepository(SesionConversacion)
        private readonly sesionRepo: Repository<SesionConversacion>,
        @InjectRepository(Mensaje)
        private readonly mensajeRepo: Repository<Mensaje>,
        @InjectRepository(HistorialChatAi)
        private readonly historialAiRepo: Repository<HistorialChatAi>,
        @InjectRepository(Cita)
        private readonly citaRepo: Repository<Cita>,
        @InjectRepository(Proyecto)
        private readonly proyectoRepo: Repository<Proyecto>,
        @InjectRepository(UnidadProyecto)
        private readonly unidadRepo: Repository<UnidadProyecto>,
    ) { }

    async procesarEventoWebhook(eventoId: number): Promise<void> {
        const evento = await this.eventoWebhookRepo.findOne({ where: { id: eventoId } });
        if (!evento) {
            this.logger.warn(`[Sperant][Webhook] Evento ${eventoId} no encontrado`);
            return;
        }

        if (evento.estado === 'procesado') {
            return;
        }

        evento.estado = 'procesando';
        evento.intentos += 1;
        await this.eventoWebhookRepo.save(evento);

        try {
            const normalizado = this.normalizarPayload(evento.payload);
            const proyecto = await this.servicioProyectosSperant.resolverProyectoLocal(
                evento.codigoEmpresa,
                normalizado.proyectoIdSperant,
                normalizado.interesNombre,
            );

            const resultado = await this.crearOActualizarLeadDesdeSperant(
                evento.codigoEmpresa,
                normalizado,
                proyecto,
            );

            await this.registrarContextoWebhook(resultado.lead, evento.codigoEmpresa, normalizado, proyecto);
            await this.enviarPrimerMensajeSiCorresponde(resultado.lead, evento.codigoEmpresa, proyecto, normalizado);

            evento.estado = 'procesado';
            evento.leadUuid = resultado.lead.uuid;
            evento.errorUltimo = null;
            evento.procesadoAt = new Date();
            await this.eventoWebhookRepo.save(evento);
        } catch (error) {
            const mensaje = error instanceof Error ? error.message : 'Error desconocido procesando webhook SPERANT';
            evento.estado = 'error';
            evento.errorUltimo = mensaje;
            await this.eventoWebhookRepo.save(evento);
            this.logger.error(`[Sperant][Webhook] Error procesando evento ${eventoId}: ${mensaje}`);
            throw error;
        }
    }

    async asegurarClienteEnSperantDesdeLead(params: {
        leadUuid: string;
        codigoEmpresa: number;
        inputChannelId?: number;
        sourceId?: number;
        interestTypeId?: number;
    }): Promise<MapeoContactoSperant> {
        const mappingExistente = await this.mapeoContactoRepo.findOne({
            where: {
                codigoEmpresa: params.codigoEmpresa,
                leadUuid: params.leadUuid,
            },
        });

        if (mappingExistente) {
            return mappingExistente;
        }

        const lead = await this.leadRepo.findOne({
            where: {
                uuid: params.leadUuid,
                codigoEmpresa: params.codigoEmpresa,
            },
        });

        if (!lead) {
            throw new Error(`Lead ${params.leadUuid} no encontrado para sincronización SPERANT`);
        }

        const inputChannelId = params.inputChannelId || Number(this.configService.get<string>('SPERANT_DEFAULT_INPUT_CHANNEL_ID') || 0);
        const sourceId = params.sourceId || Number(this.configService.get<string>('SPERANT_DEFAULT_SOURCE_ID') || 0);
        const interestTypeId = params.interestTypeId || Number(this.configService.get<string>('SPERANT_DEFAULT_INTEREST_TYPE_ID') || 0);

        if (!inputChannelId || !sourceId || !interestTypeId) {
            throw new Error(
                'Faltan SPERANT_DEFAULT_INPUT_CHANNEL_ID, SPERANT_DEFAULT_SOURCE_ID o SPERANT_DEFAULT_INTEREST_TYPE_ID para asegurar el cliente',
            );
        }

        const payload = {
            fname: lead.nombre || lead.nombreMeta || 'Cliente',
            lname: lead.apellido || undefined,
            email: lead.email || undefined,
            phone: lead.telefono || undefined,
            document: lead.dni || undefined,
            input_channel_id: inputChannelId,
            source_id: sourceId,
            interest_type_id: interestTypeId,
        };

        const response = await this.servicioApiSperant.crearCliente(params.codigoEmpresa, payload);
        const clienteIdSperant = this.extraerIdSperant(response, 'cliente');

        const mapping = this.mapeoContactoRepo.create({
            codigoEmpresa: params.codigoEmpresa,
            leadId: lead.id,
            leadUuid: lead.uuid,
            clienteIdSperant,
            documento: lead.dni || null,
            email: lead.email || null,
            telefono: lead.telefono || null,
            estado: 'activo',
        });

        return this.mapeoContactoRepo.save(mapping);
    }

    async sincronizarCitaDesdeAgendaLocal(params: {
        idCitaLocal: number;
        codigoEmpresa: number;
        leadUuid: string;
        place?: string;
        duration?: number;
        creatorId?: number;
        eventTypeId?: number;
        unitIdSperant?: number;
    }): Promise<SincronizacionCitaSperant> {
        const cita = await this.citaRepo.findOne({
            where: {
                id: params.idCitaLocal,
                codigoEmpresa: params.codigoEmpresa,
            },
        });

        if (!cita) {
            throw new Error(`No existe la cita local ${params.idCitaLocal}`);
        }

        const lead = await this.leadRepo.findOne({
            where: {
                uuid: params.leadUuid,
                codigoEmpresa: params.codigoEmpresa,
            },
        });

        if (!lead) {
            throw new Error(`No existe el lead ${params.leadUuid}`);
        }

        const proyecto = await this.servicioProyectosSperant.obtenerProyectoSperantDesdeLocal(cita.proyectoId, params.codigoEmpresa);
        if (!proyecto?.sperantProjectId) {
            throw new Error(`El proyecto local ${cita.proyectoId} no tiene sperant_project_id configurado`);
        }

        const mapeo = await this.asegurarClienteEnSperantDesdeLead({
            leadUuid: params.leadUuid,
            codigoEmpresa: params.codigoEmpresa,
        });

        const eventTypeId = params.eventTypeId || Number(this.configService.get<string>('SPERANT_DEFAULT_EVENT_TYPE_ID') || 0);
        const creatorId = params.creatorId || Number(this.configService.get<string>('SPERANT_DEFAULT_CREATOR_ID') || 0);
        const duration = params.duration || Number(this.configService.get<string>('SPERANT_DEFAULT_DURATION_MINUTES') || 60);

        if (!eventTypeId || !creatorId) {
            throw new Error('Faltan SPERANT_DEFAULT_EVENT_TYPE_ID o SPERANT_DEFAULT_CREATOR_ID para crear citas en SPERANT');
        }

        const fechaHoraIso = `${cita.fechaCita}T${cita.horaCita}-05:00`;
        const fechaHoraUnix = Math.floor(new Date(fechaHoraIso).getTime() / 1000);

        const payload = {
            event_type_id: eventTypeId,
            name: `Cita ${cita.tipoCita || 'PRESENCIAL'} - ${lead.nombreCompleto || lead.telefono}`,
            datetime_start: fechaHoraUnix,
            creator_id: creatorId,
            duration,
            place: params.place || cita.nombreProyecto || undefined,
            description: cita.observacion || undefined,
            client_id: mapeo.clienteIdSperant,
            project_id: proyecto.sperantProjectId,
            unit_id: params.unitIdSperant || undefined,
        };

        const registro = this.syncCitaRepo.create({
            codigoEmpresa: params.codigoEmpresa,
            idCitaLocal: cita.id,
            leadUuid: params.leadUuid,
            clienteIdSperant: mapeo.clienteIdSperant,
            proyectoIdLocal: cita.proyectoId || null,
            proyectoIdSperant: proyecto.sperantProjectId || null,
            estado: 'procesando',
            payloadRequest: payload,
        });

        const syncGuardado = await this.syncCitaRepo.save(registro);

        try {
            const response = await this.servicioApiSperant.crearEvento(params.codigoEmpresa, payload);
            syncGuardado.eventoIdSperant = this.extraerIdSperant(response, 'evento');
            syncGuardado.payloadResponse = response;
            syncGuardado.estado = 'procesado';
            syncGuardado.errorUltimo = null;
            return await this.syncCitaRepo.save(syncGuardado);
        } catch (error) {
            syncGuardado.estado = 'error';
            syncGuardado.errorUltimo = error instanceof Error ? error.message : 'Error sincronizando cita';
            await this.syncCitaRepo.save(syncGuardado);
            throw error;
        }
    }

    async crearProformaEnSperant(params: {
        leadUuid: string;
        codigoEmpresa: number;
        unidadIdSperant?: number;
        tipoIdSperant?: number;
        inputChannelId?: number;
        sourceId?: number;
        templateId?: number;
        agentId?: number;
        utmSource?: string;
        utmMedium?: string;
        utmCampaign?: string;
        utmTerm?: string;
        utmContent?: string;
        extraFields?: Record<string, any>;
    }): Promise<SincronizacionProformaSperant> {
        if (!params.unidadIdSperant && !params.tipoIdSperant) {
            throw new Error('Para crear proforma en SPERANT se requiere unidadIdSperant o tipoIdSperant');
        }

        const lead = await this.leadRepo.findOne({
            where: {
                uuid: params.leadUuid,
                codigoEmpresa: params.codigoEmpresa,
            },
        });

        if (!lead) {
            throw new Error(`No existe el lead ${params.leadUuid}`);
        }

        const sesion = await this.sesionRepo.findOne({
            where: {
                leadUuid: params.leadUuid,
                codigoEmpresa: params.codigoEmpresa,
            },
        });

        const proyecto = sesion?.proyectoId
            ? await this.servicioProyectosSperant.obtenerProyectoSperantDesdeLocal(sesion.proyectoId, params.codigoEmpresa)
            : null;

        const mapping = await this.asegurarClienteEnSperantDesdeLead({
            leadUuid: params.leadUuid,
            codigoEmpresa: params.codigoEmpresa,
        });

        const payload = {
            client_id: mapping.clienteIdSperant,
            unit_id: params.unidadIdSperant,
            type_id: params.tipoIdSperant,
            input_channel_id: params.inputChannelId,
            source_id: params.sourceId,
            template_id: params.templateId,
            agent_id: params.agentId,
            utm_source: params.utmSource,
            utm_medium: params.utmMedium,
            utm_campaign: params.utmCampaign,
            utm_term: params.utmTerm,
            utm_content: params.utmContent,
            extra_fields: params.extraFields,
        };

        const registro = await this.syncProformaRepo.save(this.syncProformaRepo.create({
            codigoEmpresa: params.codigoEmpresa,
            leadUuid: params.leadUuid,
            clienteIdSperant: mapping.clienteIdSperant,
            proyectoIdLocal: proyecto?.id || null,
            proyectoIdSperant: proyecto?.sperantProjectId || null,
            unidadIdSperant: params.unidadIdSperant || null,
            tipoIdSperant: params.tipoIdSperant || null,
            estado: 'procesando',
            payloadRequest: payload,
        }));

        try {
            const response = await this.servicioApiSperant.crearProforma(params.codigoEmpresa, payload);
            registro.proformaIdSperant = this.extraerIdSperant(response, 'proforma');
            registro.payloadResponse = response;
            registro.estado = 'procesado';
            registro.errorUltimo = null;
            return await this.syncProformaRepo.save(registro);
        } catch (error) {
            registro.estado = 'error';
            registro.errorUltimo = error instanceof Error ? error.message : 'Error creando proforma en SPERANT';
            await this.syncProformaRepo.save(registro);
            throw error;
        }
    }

    private async crearOActualizarLeadDesdeSperant(
        codigoEmpresa: number,
        normalizado: LeadSperantNormalizado,
        proyecto: Proyecto | null,
    ): Promise<{ lead: Lead }> {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const origen = await this.asegurarOrigenSperant(queryRunner);
            const mappingExistente = await queryRunner.manager.findOne(MapeoContactoSperant, {
                where: {
                    codigoEmpresa,
                    clienteIdSperant: normalizado.clienteIdSperant,
                },
            });

            let lead: Lead | null = null;

            if (mappingExistente?.leadUuid) {
                lead = await queryRunner.manager.findOne(Lead, {
                    where: {
                        uuid: mappingExistente.leadUuid,
                        codigoEmpresa,
                    },
                });
            }

            if (!lead) {
                lead = await this.buscarLeadExistente(queryRunner, codigoEmpresa, normalizado);
            }

        if (!lead) {
            lead = queryRunner.manager.create(Lead, {
                codigoEmpresa,
                telefono: normalizado.telefono || this.generarTelefonoTemporal(normalizado.clienteIdSperant),
            });
        }

            lead.nombre = normalizado.nombre || lead.nombre || null;
            lead.apellido = normalizado.apellido || lead.apellido || null;
            lead.nombreMeta = lead.nombreMeta || [normalizado.nombre, normalizado.apellido].filter(Boolean).join(' ').trim() || null;
            lead.telefono = normalizado.telefono || lead.telefono;
            lead.email = normalizado.email || lead.email || null;
            lead.dni = normalizado.documento || lead.dni || null;
            lead.genero = normalizado.genero || lead.genero || null;

            lead = await queryRunner.manager.save(lead);

            const prospecto = queryRunner.manager.create(Prospecto, {
                idLead: lead.id,
                codigoEmpresa,
                origenId: origen.id,
                origenDato: 'Sperant',
                interesTipoId: proyecto?.id || null,
                interesNombre: proyecto?.nombre || normalizado.interesNombre || `Lead ${normalizado.evento}`,
                estadoGestion: 'nuevo',
                observacion: normalizado.observacion || null,
                json_data: {
                    sperant: {
                        cliente_id: normalizado.clienteIdSperant,
                        evento: normalizado.evento,
                        proyecto_id_sperant: normalizado.proyectoIdSperant,
                        seller_id: normalizado.sellerId,
                        medio_captacion: normalizado.medioCaptacion,
                        canal_entrada: normalizado.canalEntrada,
                        ultima_interaccion_at: normalizado.ultimaInteraccionAt,
                        payload: normalizado.payload,
                    },
                },
            });
            await queryRunner.manager.save(prospecto);

            let sesion = await queryRunner.manager.findOne(SesionConversacion, {
                where: {
                    leadUuid: lead.uuid,
                    codigoEmpresa,
                },
            });

            if (!sesion) {
                sesion = queryRunner.manager.create(SesionConversacion, {
                    leadUuid: lead.uuid,
                    codigoEmpresa,
                    numeroTelefono: lead.telefono,
                    proyectoId: proyecto?.id || null,
                    proximoMensajeMinutos: 60,
                    idEstado: 1,
                });
            } else {
                sesion.numeroTelefono = lead.telefono || sesion.numeroTelefono;
                if (proyecto?.id) {
                    sesion.proyectoId = proyecto.id;
                }
            }
            await queryRunner.manager.save(sesion);

            const mapping = mappingExistente || queryRunner.manager.create(MapeoContactoSperant, {
                codigoEmpresa,
                leadId: lead.id,
                leadUuid: lead.uuid,
                clienteIdSperant: normalizado.clienteIdSperant,
            });
            mapping.leadId = lead.id;
            mapping.leadUuid = lead.uuid;
            mapping.documento = normalizado.documento || lead.dni || null;
            mapping.email = normalizado.email || lead.email || null;
            mapping.telefono = normalizado.telefono || lead.telefono || null;
            mapping.estado = 'activo';
            await queryRunner.manager.save(mapping);

            await queryRunner.commitTransaction();
            return { lead };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    private async asegurarOrigenSperant(queryRunner: QueryRunner): Promise<OrigenDato> {
        let origen = await queryRunner.manager.findOne(OrigenDato, {
            where: {
                nombre: 'Sperant',
            },
        });

        if (!origen) {
            origen = queryRunner.manager.create(OrigenDato, { nombre: 'Sperant' });
            await queryRunner.manager.save(origen);
        }

        return origen;
    }

    private async buscarLeadExistente(
        queryRunner: QueryRunner,
        codigoEmpresa: number,
        normalizado: LeadSperantNormalizado,
    ): Promise<Lead | null> {
        if (normalizado.documento) {
            const porDocumento = await queryRunner.manager.findOne(Lead, {
                where: {
                    dni: normalizado.documento,
                    codigoEmpresa,
                },
            });

            if (porDocumento) {
                return porDocumento;
            }
        }

        if (normalizado.email) {
            const porEmail = await queryRunner.manager.findOne(Lead, {
                where: {
                    email: normalizado.email,
                    codigoEmpresa,
                },
            });

            if (porEmail) {
                return porEmail;
            }
        }

        if (normalizado.telefono) {
            const porTelefono = await queryRunner.manager.findOne(Lead, {
                where: {
                    telefono: normalizado.telefono,
                    codigoEmpresa,
                },
            });

            if (porTelefono) {
                return porTelefono;
            }
        }

        return null;
    }

    private async registrarContextoWebhook(
        lead: Lead,
        codigoEmpresa: number,
        normalizado: LeadSperantNormalizado,
        proyecto: Proyecto | null,
    ): Promise<void> {
        const contenido = [
            `Webhook SPERANT recibido: ${normalizado.evento}`,
            `Cliente SPERANT: ${normalizado.clienteIdSperant}`,
            proyecto ? `Proyecto local asociado: ${proyecto.nombre} (${proyecto.id})` : 'Proyecto local asociado: pendiente',
            normalizado.observacion ? `Observación: ${normalizado.observacion}` : null,
        ].filter(Boolean).join('\n');

        await this.historialAiRepo.save(this.historialAiRepo.create({
            leadUuid: lead.uuid,
            codigoEmpresa,
            input: { role: 'system', content: contenido },
            role: 'system',
            nombreModelo: 'sperant-webhook',
            metadatos: {
                origen: 'webhook_sperant',
                evento: normalizado.evento,
                cliente_id_sperant: normalizado.clienteIdSperant,
                proyecto_id_sperant: normalizado.proyectoIdSperant,
            },
        }));
    }

    private async enviarPrimerMensajeSiCorresponde(
        lead: Lead,
        codigoEmpresa: number,
        proyecto: Proyecto | null,
        normalizado: LeadSperantNormalizado,
    ): Promise<void> {
        if (!lead.telefono || !/^\d+$/.test(lead.telefono)) {
            this.logger.warn(`[Sperant][Bienvenida] Lead ${lead.uuid} sin teléfono, se omite envío`);
            return;
        }

        const yaRecibio = await this.historialEnviosService.haRecibidoMensajeReciente(
            lead.id,
            TipoPlantilla.PRIMER_CONTACTO,
            1,
        );

        if (yaRecibio) {
            this.logger.log(`[Sperant][Bienvenida] Lead ${lead.uuid} ya recibió primer contacto recientemente`);
            return;
        }

        const plantilla = await this.plantillasService.obtenerPlantillaPorTipo(TipoPlantilla.PRIMER_CONTACTO, codigoEmpresa);
        if (!plantilla?.nombre) {
            this.logger.warn(`[Sperant][Bienvenida] No existe plantilla PRIMER_CONTACTO configurada para empresa ${codigoEmpresa}`);
            return;
        }

        const nombreCliente = lead.nombre || lead.nombreMeta || 'Cliente';
        const nombreProyecto = proyecto?.nombre || normalizado.interesNombre || 'Nuestro Proyecto';
        const components = this.construirComponentesPlantilla(plantilla, nombreCliente, nombreProyecto);
        const contenidoProcesado = this.renderizarContenidoPlantilla(plantilla, nombreCliente, nombreProyecto);

        const response: any = await this.wapiService.sendTemplate(
            codigoEmpresa,
            lead.telefono,
            plantilla.nombre,
            plantilla.idioma || 'es_PE',
            components,
        );

        let wamid = null;
        let estado = 'enviado';
        let errorDetails = null;

        if (response?.error) {
            estado = 'fallido';
            errorDetails = response.details;
        } else {
            wamid = response?.messages?.[0]?.id || response?.id || null;
        }

        const mensaje = await this.mensajeRepo.save(this.mensajeRepo.create({
            codigoEmpresa,
            leadUuid: lead.uuid,
            idUsuario: null,
            idEmisorTipo: 2,
            contenido: contenidoProcesado,
            numeroTelefono: lead.telefono,
            tipoMultimedia: 'text',
            estadoMensaje: estado,
            wamidMsg: wamid ? String(wamid) : null,
            errorWapi: errorDetails,
            leido: 0,
            conversacionFacturable: 0,
            fechaEnvio: new Date(),
            fechaCreacion: new Date(),
        }));

        await this.historialEnviosService.registrarEnvio(
            lead.id,
            TipoPlantilla.PRIMER_CONTACTO,
            plantilla.id,
            estado === 'enviado' ? 'ENVIADO' : 'FALLIDO',
            {
                origen: 'webhook_sperant',
                proyectoId: proyecto?.id || null,
                proyectoIdSperant: normalizado.proyectoIdSperant || null,
                wamid,
                mensajeId: mensaje.id,
                error: errorDetails,
            },
        );

        await this.historialAiRepo.save(this.historialAiRepo.create({
            leadUuid: lead.uuid,
            codigoEmpresa,
            input: { role: 'assistant', content: contenidoProcesado },
            role: 'assistant',
            nombreModelo: 'sperant-bienvenida',
            metadatos: {
                origen: 'webhook_sperant',
                plantilla: plantilla.nombre,
                mensaje_id: mensaje.id,
                status: estado,
                wamid,
            },
        }));
    }

    private construirComponentesPlantilla(
        plantilla: PlantillaMensaje,
        nombreCliente: string,
        nombreProyecto: string,
    ): any[] {
        const components = [];
        const bodyParams = [];

        for (const parametro of plantilla.parametros || []) {
            if (parametro === 'name') {
                bodyParams.push({ type: 'text', parameter_name: 'name', text: nombreCliente });
            }
            if (parametro === 'project') {
                bodyParams.push({ type: 'text', parameter_name: 'project', text: nombreProyecto });
            }
        }

        if (bodyParams.length > 0) {
            components.push({ type: 'body', parameters: bodyParams });
        }

        return components;
    }

    private renderizarContenidoPlantilla(
        plantilla: PlantillaMensaje,
        nombreCliente: string,
        nombreProyecto: string,
    ): string {
        let contenido = plantilla.contenido;
        contenido = contenido.replace(/\{\{name\}\}/g, nombreCliente);
        contenido = contenido.replace(/\{\{project\}\}/g, nombreProyecto);
        return contenido;
    }

    private normalizarPayload(payload: any): LeadSperantNormalizado {
        const client = payload?.client || {};
        const lastProject = client?.last_interaction_project || {};

        return {
            evento: payload?.event_name,
            clienteIdSperant: Number(client?.id),
            creadoEn: client?.created_at || null,
            nombre: this.limpiarTexto(client?.fname),
            apellido: this.limpiarTexto(client?.lname),
            documento: this.limpiarTexto(client?.document),
            tipoDocumento: this.limpiarTexto(client?.document_type_name),
            telefono: this.limpiarTelefono(client?.phone),
            email: this.limpiarEmail(client?.email),
            genero: this.limpiarTexto(client?.gender),
            observacion: this.limpiarTexto(client?.observation),
            ultimaInteraccionAt: client?.last_interaction_at || null,
            proyectoIdSperant: Number(lastProject?.project_id || client?.project_id || 0) || null,
            interesNombre: this.limpiarTexto(lastProject?.interest_type_name || client?.interest_type_name),
            medioCaptacion: this.limpiarTexto(lastProject?.captation_way || client?.captation_way),
            canalEntrada: this.limpiarTexto(lastProject?.input_channel_name || client?.input_channel_name),
            sellerId: Number(lastProject?.seller_id || 0) || null,
            payload,
        };
    }

    private limpiarTelefono(valor?: string): string | null {
        if (!valor) {
            return null;
        }

        const telefono = String(valor).replace(/\D/g, '');
        return telefono || null;
    }

    private limpiarEmail(valor?: string): string | null {
        if (!valor) {
            return null;
        }

        return String(valor).trim().toLowerCase();
    }

    private limpiarTexto(valor?: string): string | null {
        if (!valor) {
            return null;
        }

        const limpio = String(valor).trim();
        return limpio.length > 0 ? limpio : null;
    }

    private extraerIdSperant(response: any, tipo: string): number {
        const valor = response?.data?.attributes?.id || response?.data?.id || response?.id;
        const numero = Number(valor);

        if (!numero) {
            throw new Error(`SPERANT no devolvió un id válido para ${tipo}`);
        }

        return numero;
    }

    private generarTelefonoTemporal(clienteIdSperant: number): string {
        return `sperant_${clienteIdSperant}`;
    }
}
