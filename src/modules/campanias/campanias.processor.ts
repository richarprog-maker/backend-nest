import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Campania, EstadoCampania } from './entities/campania.entity';
import { CampaniaDetalle, EstadoCampaniaDetalle } from './entities/campania-detalle.entity';
import { CampaniaProgramada, EstadoCampaniaProgramada } from './entities/campania-programada.entity';
import { Lead } from '../inbox/entities/lead.entity';
import { Prospecto } from '../inbox/entities/prospecto.entity';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { HistorialClasificacionLead } from '../clasificacion-leads/entities/historial-clasificacion-lead.entity';
import { Mensaje } from '../inbox/entities/mensaje.entity';
import { WapiService } from '../webhook_meta/wapi.service';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

@Processor('campanias', { concurrency: 5 })
export class CampaniasProcessor extends WorkerHost {
    private readonly logger = new Logger(CampaniasProcessor.name);

    constructor(
        @InjectRepository(Campania)
        private campaniaRepo: Repository<Campania>,
        @InjectRepository(CampaniaDetalle)
        private detalleRepo: Repository<CampaniaDetalle>,
        @InjectRepository(CampaniaProgramada)
        private programadaRepo: Repository<CampaniaProgramada>,
        @InjectRepository(Lead)
        private leadRepo: Repository<Lead>,
        @InjectRepository(Prospecto)
        private prospectoRepo: Repository<Prospecto>,
        @InjectRepository(SesionConversacion)
        private sesionRepo: Repository<SesionConversacion>,
        @InjectRepository(HistorialClasificacionLead)
        private clasificacionRepo: Repository<HistorialClasificacionLead>,
        @InjectRepository(Mensaje)
        private mensajeRepo: Repository<Mensaje>,
        private wapiService: WapiService,
        @InjectQueue('campanias') private campaniasQueue: Queue,
        private dataSource: DataSource
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        this.logger.log(`Procesando job ${job.name} (ID: ${job.id})`);

        switch (job.name) {
            case 'procesar-audiencia':
                return this.handleProcesarAudiencia(job.data);
            case 'enviar-mensaje':
                return this.handleEnviarMensaje(job.data);
            default:
                this.logger.warn(`Job desconocido: ${job.name}`);
        }
    }

    private async handleProcesarAudiencia(data: {
        campaniaId: number;
        codigoEmpresa?: number;
        esProgramada?: boolean;
        programadaId?: number;
    }) {
        const { campaniaId, esProgramada, programadaId } = data;
        this.logger.log(`Inicio procesamiento audiencia para campaña #${campaniaId}`);

        try {
            if (esProgramada && programadaId) {
                const programada = await this.programadaRepo.findOne({
                    where: { id: programadaId }
                });

                if (!programada) {
                    throw new Error(`Programación ${programadaId} no encontrada`);
                }

                if (programada.estado === EstadoCampaniaProgramada.CANCELADO) {
                    this.logger.warn(`Campaña programada #${programadaId} cancelada. Se omite el procesamiento.`);
                    return { success: false, skipped: true, reason: 'programacion_cancelada' };
                }

                if (programada.fechaProgramada && programada.fechaProgramada > new Date()) {
                    await this.programadaRepo.update(programadaId, {
                        estado: EstadoCampaniaProgramada.PENDIENTE,
                        fechaEjecucion: null,
                        errorLog: null
                    });

                    this.logger.warn(
                        `Se evitó un envío anticipado para la campaña #${campaniaId}. Programada para ${programada.fechaProgramada.toISOString()}`
                    );
                    return { success: false, skipped: true, reason: 'fecha_programada_no_alcanzada' };
                }
            }

            const campania = await this.campaniaRepo.findOne({
                where: { id: campaniaId },
                relations: ['plantilla']
            });

            if (!campania) throw new Error('Campaña no encontrada');

            if (campania.plantilla && campania.plantilla.metaStatus !== 'APPROVED' && campania.plantilla.metaStatus !== 'LOCAL') {
                throw new Error(`Plantilla no aprobada en Meta. Estado: ${campania.plantilla.metaStatus}`);
            }

            let destinatarios: any[] = [];

            if (campania.tipoAudiencia === 'excel' && campania.archivoAudienciaPath) {
                if (fs.existsSync(campania.archivoAudienciaPath)) {
                    const workbook = xlsx.readFile(campania.archivoAudienciaPath);
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rawData = xlsx.utils.sheet_to_json(sheet);

                    destinatarios = rawData.map((row: any) => ({
                        telefono: row['telefono'] || row['celular'] || row['movil'] || row['Telefono'] || row['Celular'] || row['phone'] || row['Phone'],
                        nombre: row['nombre'] || row['nombres'] || row['Nombre'] || row['fname'] || row['Fname'] || '',
                        apellido: row['apellido'] || row['apellidos'] || row['Apellido'] || row['lname'] || row['Lname'] || '',
                        email: row['email'] || row['correo'] || row['Email'] || '',
                        documento: row['document'] || row['documento'] || row['dni'] || '',
                        direccion: row['address'] || row['direccion'] || '',
                        genero: row['gender'] || row['genero'] || '',
                        pais: row['country'] || row['pais'] || '',
                        ciudad: row['city'] || row['ciudad'] || '',
                        departamento: row['department'] || row['departamento'] || '',
                        fechaNacimiento: row['date_of_birth'] || row['fecha_nacimiento'] || row['fechaNacimiento'] || '',
                        projectId: row['project_id'] || row['proyecto_id'] || '',
                        utmSource: row['utm_source'] || '',
                        utmMedium: row['utm_medium'] || '',
                        utmCampaign: row['utm_campaign'] || '',
                        observacion: row['observacion'] || row['observaciones'] || '',
                        variables: row
                    })).filter(d => d.telefono);
                } else {
                    throw new Error('Archivo de audiencia no existe en disco');
                }
            } else if (campania.tipoAudiencia === 'base_datos') {
                //  OBTENER LEADS DESDE BASE DE DATOS CON FILTROS
                this.logger.log('Obteniendo audiencia desde base de datos con filtros...');
                destinatarios = await this.obtenerLeadsPorFiltros(
                    campania.filtrosAudiencia,
                    campania.codigoEmpresa
                );
            }

            this.logger.log(`Se encontraron ${destinatarios.length} destinatarios para la campaña #${campaniaId}`);

            const chunkSize = 100;
            const dbBatchSize = 20; // Procesar leads en lotes más pequeños para no saturar DB
            let totalProcesados = 0;

            for (let i = 0; i < destinatarios.length; i += chunkSize) {
                const chunk = destinatarios.slice(i, i + chunkSize);

                const detallesConLeads: any[] = [];
                for (let j = 0; j < chunk.length; j += dbBatchSize) {
                    const subChunk = chunk.slice(j, j + dbBatchSize);
                    const subResults = await Promise.all(subChunk.map(async (d) => {
                        const telefonoLimpio = String(d.telefono).trim().replace(/\D/g, '');

                        const { lead, prospecto, clasificacion } = await this.procesarLeadYProspecto(
                            telefonoLimpio,
                            d.nombre,
                            d.email,
                            campania.codigoEmpresa,
                            campania.nombre,
                            campania.tipoAudiencia,
                            {
                                apellido: d.apellido,
                                documento: d.documento,
                                direccion: d.direccion,
                                genero: d.genero,
                                pais: d.pais,
                                ciudad: d.ciudad,
                                observacion: d.observacion,
                                fechaNacimiento: d.fechaNacimiento,
                                projectId: campania.proyectoId || d.projectId,
                                utmSource: d.utmSource,
                                utmMedium: d.utmMedium,
                                utmCampaign: d.utmCampaign,
                            }
                        );

                        let tipoMultimedia = 'none';
                        let urlMultimedia = null;

                        if (campania.plantilla?.url_multimedia) {
                            const tipoPlantilla = (campania.plantilla.tipo_contenido_multimedia || '').toLowerCase();

                            if (tipoPlantilla === 'imagen' || tipoPlantilla === 'image') {
                                tipoMultimedia = 'image';
                            } else if (tipoPlantilla === 'video') {
                                tipoMultimedia = 'video';
                            } else if (tipoPlantilla === 'documento' || tipoPlantilla === 'document') {
                                tipoMultimedia = 'document';
                            } else if (tipoPlantilla === 'audio') {
                                tipoMultimedia = 'audio';
                            } else {
                                tipoMultimedia = tipoPlantilla === 'ninguno' ? 'none' : tipoPlantilla;
                            }

                            urlMultimedia = campania.plantilla.url_multimedia;
                        } else if (campania.imagenUrl) {
                            tipoMultimedia = 'image';
                            urlMultimedia = campania.imagenUrl;
                        }

                        return {
                            campaniaId: campania.id,
                            telefono: telefonoLimpio,
                            nombre: d.nombre,
                            variables: d.variables,
                            estado: EstadoCampaniaDetalle.PENDIENTE,
                            tipoMultimedia,
                            urlMultimedia,
                            leadId: lead?.id || null,
                            leadUuid: lead?.uuid || null,
                            prospectoId: prospecto?.id || null,
                            clasificacionLead: clasificacion || null,
                            projectId: campania.proyectoId || d.projectId || null
                        };
                    }));
                    detallesConLeads.push(...subResults);
                }

                const entities = detallesConLeads.map(d => this.detalleRepo.create(d as Record<string, any>));
                const savedChunk = await this.detalleRepo.save(entities as any);

                const usarTemplate = campania.plantilla?.metaStatus === 'APPROVED' && campania.plantilla?.nombre;

                const leadUuidMap = new Map<number, string>();
                const projectIdMap = new Map<number, number | null>();
                detallesConLeads.forEach((d, idx) => {
                    if (d.leadUuid && savedChunk[idx]) {
                        leadUuidMap.set(savedChunk[idx].id, d.leadUuid);
                    }
                    if (savedChunk[idx]) {
                        projectIdMap.set(savedChunk[idx].id, d.projectId ? Number(d.projectId) : null);
                    }
                });

                const jobs = savedChunk.map((detalle, index) => ({
                    name: 'enviar-mensaje',
                    data: {
                        detalleId: detalle.id,
                        campaniaId: campania.id,
                        plantillaCuerpo: campania.plantilla?.contenido,
                        codigoEmpresa: campania.codigoEmpresa,
                        usarTemplate: usarTemplate,
                        templateName: campania.plantilla?.nombre,
                        templateParams: campania.plantilla?.parametros,
                        tipoMultimedia: detalle.tipoMultimedia,
                        urlMultimedia: detalle.urlMultimedia,
                        leadUuid: leadUuidMap.get(detalle.id) || null,
                        proyectoId: projectIdMap.get(detalle.id) ?? null
                    },
                    opts: {
                        removeOnComplete: true,
                        removeOnFail: 50,
                        delay: (i + index) * 200,
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 5000
                        }
                    }
                }));

                await this.campaniasQueue.addBulk(jobs);
                totalProcesados += savedChunk.length;
            }

            // Actualizar stats de campaña
            const statsInicial = JSON.stringify({ total: totalProcesados, enviados: 0, fallidos: 0 });
            await this.campaniaRepo.update(campaniaId, {
                stats: statsInicial as any,
                estado: EstadoCampania.PROCESANDO
            });

            // Si es programada, marcar como completado el registro de programación
            if (esProgramada && programadaId) {
                await this.programadaRepo.update(programadaId, {
                    estado: EstadoCampaniaProgramada.COMPLETADO
                });
            }

            return { success: true, count: totalProcesados };

        } catch (error) {
            this.logger.error(`Error procesando audiencia: ${error.message}`);

            if (esProgramada && programadaId) {
                await this.programadaRepo.update(programadaId, {
                    estado: EstadoCampaniaProgramada.FALLIDO,
                    errorLog: error.message
                });
            }

            throw error;
        }
    }

    private async procesarLeadYProspecto(
        telefono: string,
        nombre: string,
        email: string,
        codigoEmpresa: number,
        nombreCampania: string,
        tipoAudiencia: string = 'base_datos',
        datosExtra?: {
            apellido?: string;
            documento?: string;
            direccion?: string;
            genero?: string;
            pais?: string;
            ciudad?: string;
            observacion?: string;
            fechaNacimiento?: string | Date;
            projectId?: string | number;
            utmSource?: string;
            utmMedium?: string;
            utmCampaign?: string;
        }
    ): Promise<{ lead: Lead | null; prospecto: Prospecto | null; clasificacion: string | null }> {
        try {
            // Buscar lead existente
            let lead = await this.leadRepo.findOne({
                where: { telefono, codigoEmpresa }
            });

            // Si no existe, crear nuevo lead con datos completos
            if (!lead) {
                lead = this.leadRepo.create({
                    telefono,
                    nombre: nombre || null,
                    apellido: datosExtra?.apellido || null,
                    email: email || null,
                    dni: datosExtra?.documento || null,
                    direccion: datosExtra?.direccion || null,
                    genero: datosExtra?.genero || null,
                    pais: datosExtra?.pais || null,
                    ciudad: datosExtra?.ciudad || null,
                    fechaNacimiento: datosExtra?.fechaNacimiento ? new Date(datosExtra.fechaNacimiento) : null,
                    codigoEmpresa
                });
                lead = await this.leadRepo.save(lead);
                this.logger.debug(`Lead creado: ${lead.id} (tel: ${telefono})`);
            }

            let prospecto: Prospecto | null = null;

            // SOLO crear nuevo prospecto si es carga de Excel
            if (tipoAudiencia === 'excel') {
                const json_data = {
                    ...(datosExtra?.utmSource && { utm_source: datosExtra.utmSource }),
                    ...(datosExtra?.utmMedium && { utm_medium: datosExtra.utmMedium }),
                    ...(datosExtra?.utmCampaign && { utm_campaign: datosExtra.utmCampaign })
                };

                prospecto = this.prospectoRepo.create({
                    idLead: lead.id,
                    codigoEmpresa,
                    origenDato: 'Campaña',
                    interesNombre: nombreCampania,
                    interesTipoId: datosExtra?.projectId ? Number(datosExtra?.projectId) : null,
                    estadoGestion: 'nuevo',
                    contadorCampanias: 1,
                    observacion: datosExtra?.observacion || null,
                    json_data: Object.keys(json_data).length > 0 ? json_data : null
                });
                prospecto = await this.prospectoRepo.save(prospecto);
            } else {
                // Si es base de datos (filtros/temperatura), buscar el ultimo prospecto para incrementar contador
                // PERO NO crear uno nuevo
                prospecto = await this.prospectoRepo.findOne({
                    where: { idLead: lead.id, codigoEmpresa },
                    order: { id: 'DESC' }
                });
            }

            // Obtener última clasificación del lead
            let clasificacion: string | null = null;
            const sesion = await this.sesionRepo.findOne({
                where: { leadUuid: lead.uuid, codigoEmpresa }
            });

            if (sesion) {
                const ultimaClasificacion = await this.clasificacionRepo.findOne({
                    where: { idSesion: sesion.id },
                    order: { id: 'DESC' }
                });
                clasificacion = ultimaClasificacion?.clasificacion || null;
            }

            // Para leads de Excel que no tienen sesión, pre-crear la sesión
            // para que al enviar el mensaje se active el ciclo de recuperación
            if (!sesion && tipoAudiencia === 'excel') {
                const nuevaSesion = this.sesionRepo.create({
                    leadUuid: lead.uuid,
                    codigoEmpresa,
                    numeroTelefono: lead.telefono,
                    idEstado: 1,
                    proximoMensajeMinutos: 60,
                    fechaHoraUltimoMsj: new Date(),
                    proyectoId: datosExtra?.projectId ? Number(datosExtra.projectId) : null,
                });
                await this.sesionRepo.save(nuevaSesion);
                this.logger.debug(`[Excel] Sesión pre-creada para nuevo lead ${lead.uuid}`);
            } else if (sesion && tipoAudiencia === 'excel') {
                let sesionActualizada = false;

                if (!sesion.numeroTelefono || sesion.numeroTelefono !== lead.telefono) {
                    sesion.numeroTelefono = lead.telefono;
                    sesionActualizada = true;
                }

                const projectId = datosExtra?.projectId ? Number(datosExtra.projectId) : null;
                if (projectId && sesion.proyectoId !== projectId) {
                    sesion.proyectoId = projectId;
                    sesionActualizada = true;
                }

                if (sesionActualizada) {
                    await this.sesionRepo.save(sesion);
                    this.logger.debug(`[Excel] Sesión actualizada para lead ${lead.uuid}`);
                }
            }

            return { lead, prospecto, clasificacion };

        } catch (error) {
            this.logger.error(`Error procesando lead/prospecto: ${error.message}`);
            return { lead: null, prospecto: null, clasificacion: null };
        }
    }

    private async handleEnviarMensaje(data: {
        detalleId: number;
        campaniaId: number;
        plantillaCuerpo: string;
        codigoEmpresa: number;
        usarTemplate?: boolean;
        templateName?: string;
        templateLanguage?: string;
        templateParams?: string[];
        tipoMultimedia?: string;
        urlMultimedia?: string;
        leadUuid?: string;
        proyectoId?: number;
    }) {
        const { detalleId, campaniaId, plantillaCuerpo, codigoEmpresa, usarTemplate, templateName, templateLanguage, templateParams, tipoMultimedia, urlMultimedia, leadUuid } = data;

        try {
            const detalle = await this.detalleRepo.findOne({ where: { id: detalleId } });
            if (!detalle) return;

            // Verificar si la campaña fue pausada antes de enviar
            const campania = await this.campaniaRepo.findOne({ where: { id: campaniaId } });
            if (campania?.estado === EstadoCampania.PAUSADO) {
                this.logger.debug(`Campaña #${campaniaId} pausada, saltando envío de detalle #${detalleId}`);
                return;
            }

            let response;
            let mensajeContenido = '';
            let tipoEnvio = 'text';

            if (usarTemplate && templateName) {
                const components = await this.buildTemplateComponents(detalle.variables, templateParams, tipoMultimedia, urlMultimedia, codigoEmpresa);
                response = await this.wapiService.sendTemplate(
                    codigoEmpresa,
                    detalle.telefono,
                    templateName,
                    templateLanguage || 'es_PE',
                    components
                );
                // Guardar contenido real de la plantilla (con variables reemplazadas)
                mensajeContenido = plantillaCuerpo
                    ? this.reemplazarVariables(plantillaCuerpo, detalle.variables)
                    : `Template: ${templateName}`;
                tipoEnvio = 'template';

            } else if (detalle.tipoMultimedia && detalle.tipoMultimedia !== 'none' && detalle.urlMultimedia) {
                // Enviar multimedia según el tipo
                const fsPath = detalle.urlMultimedia.startsWith('/') ? `.${detalle.urlMultimedia}` : detalle.urlMultimedia;
                const mensajeFinal = this.reemplazarVariables(plantillaCuerpo || '', detalle.variables);

                switch (detalle.tipoMultimedia) {
                    case 'image':
                    case 'imagen':
                        response = await this.wapiService.sendImage(codigoEmpresa, detalle.telefono, fsPath, mensajeFinal);
                        tipoEnvio = 'image';
                        break;
                    case 'video':
                        response = await this.wapiService.sendVideo(codigoEmpresa, detalle.telefono, fsPath, mensajeFinal);
                        tipoEnvio = 'video';
                        break;
                    case 'audio':
                        response = await this.wapiService.sendAudio(codigoEmpresa, detalle.telefono, fsPath);
                        tipoEnvio = 'audio';
                        break;
                    case 'document':
                    case 'documento':
                        response = await this.wapiService.sendDocument(codigoEmpresa, detalle.telefono, fsPath, mensajeFinal);
                        tipoEnvio = 'document';
                        break;
                    default:
                        // Fallback a texto si el tipo no es reconocido
                        response = await this.wapiService.sendMessage(codigoEmpresa, detalle.telefono, mensajeFinal);
                        tipoEnvio = 'text';
                }
                mensajeContenido = mensajeFinal;

            } else {
                const mensajeFinal = this.reemplazarVariables(plantillaCuerpo || '', detalle.variables);
                response = await this.wapiService.sendMessage(codigoEmpresa, detalle.telefono, mensajeFinal);
                mensajeContenido = mensajeFinal;
                tipoEnvio = 'text';
            }

            if (response && !response.error) {
                const wamid = response?.messages?.[0]?.id || response?.id;
                await this.detalleRepo.update(detalleId, {
                    estado: EstadoCampaniaDetalle.ENVIADO,
                    wamid: wamid,
                    updatedAt: new Date()
                });

                const tipoMultimediaFinal = tipoMultimedia || detalle.tipoMultimedia || 'none';
                const urlMultimediaFinal = urlMultimedia || detalle.urlMultimedia || null;

                await this.registrarMensajeEnviado({
                    leadUuid: leadUuid || null,
                    codigoEmpresa,
                    numeroTelefono: detalle.telefono,
                    contenido: mensajeContenido,
                    tipoMultimedia: tipoMultimediaFinal,
                    urlMultimedia: urlMultimediaFinal,
                    wamid,
                    estadoMensaje: 'enviado',
                });

                // Resetear o crear sesion de conversacion para reiniciar ciclo de recuperacion
                if (leadUuid) {
                    await this.resetearOCrearSesion(leadUuid, codigoEmpresa, data.proyectoId);
                }

                if (detalle.prospectoId) {
                    await this.prospectoRepo.increment({ id: detalle.prospectoId }, 'contadorCampanias', 1);
                }

                await this.actualizarStatsCampania(campaniaId, 'enviados');

            } else {
                await this.detalleRepo.update(detalleId, {
                    estado: EstadoCampaniaDetalle.FALLIDO,
                    errorLog: JSON.stringify(response?.details || response),
                    updatedAt: new Date()
                });
                await this.actualizarStatsCampania(campaniaId, 'fallidos');
            }

        } catch (error) {
            this.logger.error(`Error enviando mensaje ${detalleId}: ${error.message}`);
            await this.detalleRepo.update(detalleId, {
                estado: EstadoCampaniaDetalle.FALLIDO,
                errorLog: error.message
            });
            await this.actualizarStatsCampania(campaniaId, 'fallidos');
        }
    }

    private async buildTemplateComponents(variables: any, paramNames: string[], tipoMultimedia?: string, urlMultimedia?: string, codigoEmpresa?: number): Promise<any[]> {
        const components = [];

        if (tipoMultimedia && tipoMultimedia !== 'none' && urlMultimedia) {
            const mediaTypeMap = {
                'imagen': 'image',
                'image': 'image',
                'video': 'video',
                'documento': 'document',
                'document': 'document'
            };

            const metaMediaType = mediaTypeMap[tipoMultimedia.toLowerCase()] || 'image';

            // Subir media a WhatsApp API y usar ID en vez de link URL
            // Esto es más robusto: no depende de que Meta pueda descargar desde nuestra URL
            let mediaParam: any = null;

            if (codigoEmpresa && !urlMultimedia.startsWith('http')) {
                try {
                    const filePath = urlMultimedia.startsWith('/')
                        ? path.join(process.cwd(), urlMultimedia)
                        : path.join(process.cwd(), 'storage', urlMultimedia);
                    const filename = path.basename(filePath);

                    if (fs.existsSync(filePath)) {
                        const mediaId = await this.wapiService.uploadMedia(codigoEmpresa, filePath, filename);
                        if (mediaId) {
                            mediaParam = { id: mediaId };
                            this.logger.log(`Media subida a WhatsApp API. ID: ${mediaId}`);
                        }
                    } else {
                        this.logger.warn(`Archivo multimedia no encontrado: ${filePath}`);
                    }
                } catch (uploadError) {
                    this.logger.error(`Error subiendo media a WhatsApp API: ${uploadError.message}`);
                }
            }

            // Fallback a link URL si no se pudo subir via API
            if (!mediaParam) {
                const baseUrl = (process.env.BASE_URL || 'https://checor.novalyapp.com').trim();
                const mediaUrl = urlMultimedia.startsWith('http') ? urlMultimedia : `${baseUrl}${urlMultimedia}`;
                mediaParam = { link: encodeURI(mediaUrl) };
            }

            components.push({
                type: 'header',
                parameters: [{
                    type: metaMediaType,
                    [metaMediaType]: mediaParam
                }]
            });
        }

        if (paramNames && paramNames.length > 0) {
            const bodyParams = paramNames.map(param => ({
                type: 'text',
                text: variables?.[param] || ''
            }));

            components.push({
                type: 'body',
                parameters: bodyParams
            });
        }

        return components;
    }

    private async actualizarStatsCampania(campaniaId: number, campo: 'enviados' | 'fallidos') {
        try {
            const campania = await this.campaniaRepo.findOne({ where: { id: campaniaId } });
            if (!campania) return;

            const stats = campania.stats || { total: 0, enviados: 0, fallidos: 0 };
            stats[campo] = (stats[campo] || 0) + 1;

            await this.campaniaRepo.update(campaniaId, { stats });

            const totalProcesado = stats.enviados + stats.fallidos;
            if (totalProcesado >= stats.total && stats.total > 0) {
                await this.campaniaRepo.update(campaniaId, {
                    estado: EstadoCampania.COMPLETADO
                });
                this.logger.log(`✅ Campaña #${campaniaId} COMPLETADA: ${stats.enviados} enviados, ${stats.fallidos} fallidos de ${stats.total} total`);
            }
        } catch (error) {
            this.logger.error(`Error actualizando stats: ${error.message}`);
        }
    }

    private reemplazarVariables(texto: string, variables: any): string {
        if (!variables) return texto;
        let resultado = texto;
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'gi');
            resultado = resultado.replace(regex, variables[key]);
        });
        return resultado;
    }


    private async obtenerLeadsPorFiltros(
        filtrosAudiencia: any,
        codigoEmpresa: number
    ): Promise<any[]> {
        try {
            if (!filtrosAudiencia || !Array.isArray(filtrosAudiencia)) {
                this.logger.warn('Sin filtros de audiencia, retornando array vacío');
                return [];
            }

            // Buscar filtro de temperatura
            const filtroTemperatura = filtrosAudiencia.find(
                f => f.nombre === 'temperatura' || f.nombre === 'clasificacion'
            );

            if (!filtroTemperatura || !filtroTemperatura.valores || filtroTemperatura.valores.length === 0) {
                this.logger.warn('No se encontró filtro de temperatura o está vacío');
                return [];
            }

            const temperaturas = filtroTemperatura.valores;
            this.logger.log(`Buscando leads con temperatura: ${temperaturas.join(', ')}`);

            const query = `
                SELECT DISTINCT
                    l.id_lead,
                    l.uuid,
                    l.nombre,
                    l.apellido,
                    l.telefono_principal as telefono,
                    l.email,
                    hcl.clasificacion as temperatura
                FROM tbl_leads l
                INNER JOIN tbl_sesion_conversacion sc ON sc.lead_uuid = l.uuid
                INNER JOIN tbl_historial_clasificacion_lead hcl ON hcl.id_sesion = sc.id
                WHERE l.codigo_empresa = ?
                  AND hcl.clasificacion IN (?)
                  AND hcl.id = (
                      SELECT MAX(hcl2.id)
                      FROM tbl_historial_clasificacion_lead hcl2
                      INNER JOIN tbl_sesion_conversacion sc2 ON sc2.id = hcl2.id_sesion
                      WHERE sc2.lead_uuid = l.uuid
                  )
            `;

            const leads = await this.dataSource.query(query, [codigoEmpresa, temperaturas]);

            this.logger.log(`Se encontraron ${leads.length} leads con temperatura ${temperaturas.join(', ')}`);

            return leads.map(lead => ({
                telefono: lead.telefono,
                nombre: lead.nombre || lead.apellido || 'Lead',
                email: lead.email || '',
                temperatura: lead.temperatura,
                variables: {
                    nombre: lead.nombre || lead.apellido || 'Lead',
                    apellido: lead.apellido || '',
                    telefono: lead.telefono,
                    email: lead.email || '',
                    temperatura: lead.temperatura
                }
            }));

        } catch (error) {
            this.logger.error(`Error obteniendo leads por filtros: ${error.message}`);
            return [];
        }
    }

    /**
     * Resetea la sesión de conversación existente o crea una nueva
     * para que el ciclo de recuperación (1h -> 8h -> 24h) se reinicie
     */
    private async resetearOCrearSesion(leadUuid: string, codigoEmpresa: number, proyectoId?: number): Promise<void> {
        try {
            let sesion = await this.sesionRepo.findOne({
                where: { leadUuid, codigoEmpresa }
            });

            if (sesion) {
                sesion.idEstado = 1;
                sesion.proximoMensajeMinutos = 60;
                sesion.fechaHoraUltimoMsj = new Date();
                if (proyectoId) sesion.proyectoId = proyectoId;

                // Add phone number if missing
                const lead = await this.leadRepo.findOne({ where: { uuid: leadUuid, codigoEmpresa } });
                if (lead && (!sesion.numeroTelefono || sesion.numeroTelefono !== lead.telefono)) {
                    sesion.numeroTelefono = lead.telefono;
                }

                await this.sesionRepo.save(sesion);
                this.logger.debug(`[Campania] Sesion ${sesion.id} reseteada: estado=1, proximo=60min, proyecto=${proyectoId || 'sin cambio'}`);
            } else {
                const lead = await this.leadRepo.findOne({ where: { uuid: leadUuid, codigoEmpresa } });
                const nuevaSesion = this.sesionRepo.create({
                    leadUuid,
                    codigoEmpresa,
                    numeroTelefono: lead?.telefono || '',
                    idEstado: 1,
                    proximoMensajeMinutos: 60,
                    fechaHoraUltimoMsj: new Date(),
                    proyectoId: proyectoId || null,
                });
                await this.sesionRepo.save(nuevaSesion);
                this.logger.debug(`[Campania] Nueva sesion creada para lead ${leadUuid}: estado=1, proximo=60min, proyecto=${proyectoId || 'ninguno'}`);
            }
        } catch (error) {
            this.logger.error(`Error reseteando/creando sesion para lead ${leadUuid}: ${error.message}`);
        }
    }

    /**
     * Registra cada mensaje enviado 
     */
    private async registrarMensajeEnviado(data: {
        leadUuid: string | null;
        codigoEmpresa: number;
        numeroTelefono: string;
        contenido: string;
        tipoMultimedia: string;
        urlMultimedia: string | null;
        wamid: string;
        estadoMensaje: string;
    }): Promise<void> {
        try {
            const nuevoMensaje = this.mensajeRepo.create({
                leadUuid: data.leadUuid,
                codigoEmpresa: data.codigoEmpresa,
                numeroTelefono: data.numeroTelefono,
                contenido: data.contenido,
                tipoMultimedia: data.tipoMultimedia,
                urlMultimedia: data.urlMultimedia,
                wamidMsg: data.wamid,
                estadoMensaje: data.estadoMensaje,
                idEmisorTipo: 5, // 5 = campaña 
                fechaEnvio: new Date(),
                leido: 0,
                conversacionFacturable: 0,
                errorWapi: null
            });

            await this.mensajeRepo.save(nuevoMensaje);
            this.logger.debug(`Mensaje registrado en tbl_mensajes: ${data.wamid}`);

        } catch (error) {
            this.logger.error(`Error registrando mensaje en tbl_mensajes: ${error.message}`);
        }
    }

    @OnWorkerEvent('completed')
    onCompleted(job: Job) {
        // Log silencioso
    }
}
