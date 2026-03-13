import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Lead } from '../../inbox/entities/lead.entity';
import { Prospecto } from '../../inbox/entities/prospecto.entity';
import { OrigenDato } from '../../inbox/entities/origen-dato.entity';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';
import { ServicioExcel } from './excel.service';
import { WapiService } from '../../webhook_meta/wapi.service';
import { PlantillasService } from '../../plantillas/services/plantillas.service';
import { HistorialEnviosService } from '../../historial-envios/services/historial-envios.service';
import { TipoPlantilla } from '../../plantillas/entities/plantilla.entity';
import { Proyecto } from '../../proyectos/entities/proyecto.entity';

import { Mensaje } from '../../inbox/entities/mensaje.entity';
import { HistorialChatAi } from '../../ia/entities/historial-chat-ai.entity';

@Injectable()
export class OrquestadorImportacionService {
    private readonly logger = new Logger(OrquestadorImportacionService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly servicioExcel: ServicioExcel,
        @InjectRepository(Lead) private leadRepo: Repository<Lead>,
        @InjectRepository(Prospecto) private prospectoRepo: Repository<Prospecto>,
        @InjectRepository(OrigenDato) private origenRepo: Repository<OrigenDato>,
        @InjectRepository(SesionConversacion) private sesionRepo: Repository<SesionConversacion>,
        private readonly wapiService: WapiService,
        private readonly plantillasService: PlantillasService,
        private readonly historialService: HistorialEnviosService,
        @InjectRepository(Mensaje) private mensajeRepo: Repository<Mensaje>,
        @InjectRepository(HistorialChatAi) private historialAiRepo: Repository<HistorialChatAi>,
        @InjectRepository(Proyecto) private proyectoRepo: Repository<Proyecto>,
    ) { }

    async procesarArchivoExcel(buffer: Buffer, codigoEmpresa: number, proposito: string, nombreBd: string) {
        const datosCrudos = this.servicioExcel.leerBuffer(buffer);
        const resultados = {
            total: datosCrudos.length,
            exitosos: 0,
            fallidos: 0,
            errores: []
        };
        const proyectosActivos = await this.proyectoRepo.find({
            where: { codigoEmpresa, estado: 'activo' }
        });
        const proyectosActivosPorId = new Map(
            proyectosActivos.map((proyecto) => [proyecto.id, proyecto])
        );

        this.validarFilasExcel(datosCrudos, proyectosActivosPorId);

        // Asegurar que existe origen "Excel"
        let origenExcel = await this.origenRepo.findOne({ where: { nombre: 'Excel' } });
        if (!origenExcel) {
            origenExcel = this.origenRepo.create({ nombre: 'Excel' });
            await this.origenRepo.save(origenExcel);
        }

        const plantillaPrimerContacto = await this.plantillasService.obtenerPlantillaPorTipo(TipoPlantilla.PRIMER_CONTACTO, codigoEmpresa);
        if (!plantillaPrimerContacto) {
            this.logger.warn(`[Importacion] No se encontro plantilla PRIMER_CONTACTO para empresa ${codigoEmpresa}. Los mensajes no se enviarán.`);
        }

        for (const [index, fila] of datosCrudos.entries()) {
            const queryRunner = this.dataSource.createQueryRunner();
            await queryRunner.connect();
            await queryRunner.startTransaction();

            try {
                // 1. Extraer Identidad (Lead)
                const telefono = this.limpiarTelefono(fila.phone || fila.celular || fila.telefono);
                const email = fila.email || fila.correo;
                this.logger.debug(`[Importacion] procesando fila ${index}: Tel Extrahido: ${telefono}, Email: ${email}`);

                if (!telefono && !email) {
                    throw new Error(`Fila ${index + 1}: Falta teléfono o email.`);
                }

                // Buscar o Crear Lead
                let lead = await this.buscarLead(telefono, email, codigoEmpresa, queryRunner);

                if (!lead) {
                    lead = new Lead();
                    lead.codigoEmpresa = codigoEmpresa;
                    lead.telefono = telefono;
                    lead.email = email;
                }

                // Actualizar datos de Lead (si son mejores/nuevos)
                lead.nombre = fila.fname || fila.nombre || lead.nombre;
                lead.apellido = fila.lname || fila.apellido || lead.apellido;
                lead.dni = fila.document || fila.dni || lead.dni;
                lead.direccion = fila.address || fila.direccion || lead.direccion;
                lead.genero = fila.gender || fila.genero || lead.genero;
                lead.fechaNacimiento = fila.date_of_birth ? new Date(fila.date_of_birth) : lead.fechaNacimiento;
                lead.pais = fila.country || fila.pais || lead.pais;
                lead.ciudad = fila.department || fila.ciudad || lead.ciudad;

                lead = await queryRunner.manager.save(lead);

                const proyectoIdExcel = this.resolverProyectoIdExcel(
                    fila.project_id,
                    proyectosActivosPorId,
                    index,
                );

                // 2. Crear Prospecto (se permite múltiples prospectos por lead)
                const prospecto = new Prospecto();
                prospecto.lead = lead;
                prospecto.codigoEmpresa = codigoEmpresa;
                prospecto.origenId = origenExcel.id;
                prospecto.origenDato = 'Excel';
                prospecto.interesTipoId = proyectoIdExcel;
                prospecto.interesNombre = 'Importacion Masiva ' + nombreBd;
                prospecto.estadoGestion = 'nuevo';
                prospecto.observacion = fila.observacion || null;

                // Guardar todos los datos en JSON_DATA
                const jsonData = { ...fila };
                prospecto.json_data = jsonData;

                await queryRunner.manager.save(prospecto);

                // 3. Primar Memoria IA (Contexto Lead) - DESHABILITADO
                // NOTA: La tabla tbl_contexto_lead tiene estructura diferente a la entidad
                // Se deshabilita para evitar errores de schema
                /*
                let contexto = await queryRunner.manager.findOne(ContextoLead, {
                    where: { 
                        leadUuid: lead.uuid, 
                        codigoEmpresa: codigoEmpresa 
                    }
                });

                if (!contexto) {
                    contexto = new ContextoLead();
                    contexto.leadUuid = lead.uuid;
                    contexto.codigoEmpresa = codigoEmpresa;
                    this.logger.debug(`[Importacion] Creando nuevo contexto para lead ${lead.uuid}`);
                } else {
                    this.logger.debug(`[Importacion] Contexto existente encontrado para lead ${lead.uuid}`);
                }

                contexto.nombreCompleto = `${lead.nombre || ''} ${lead.apellido || ''}`.trim();

                // Actualizar proyectos de interes
                let proyectos = contexto.proyectosInteres || [];
                if (fila.project_id && !proyectos.includes(fila.project_id)) {
                    proyectos.push(fila.project_id);
                }
                contexto.proyectosInteres = proyectos;

                await queryRunner.manager.save(contexto);
                this.logger.debug(`[Importacion] Contexto guardado para lead ${lead.uuid}`);
                */


                // 4. Crear Sesion de Conversacion
                let sesion = await queryRunner.manager.findOne(SesionConversacion, {
                    where: { leadUuid: lead.uuid, codigoEmpresa: codigoEmpresa }
                });

                if (!sesion) {
                    sesion = new SesionConversacion();
                    sesion.leadUuid = lead.uuid;
                    sesion.codigoEmpresa = codigoEmpresa;
                    sesion.numeroTelefono = lead.telefono;
                    sesion.proximoMensajeMinutos = 60;
                    if (proyectoIdExcel) sesion.proyectoId = proyectoIdExcel;

                    await queryRunner.manager.save(sesion);
                } else {
                    let necesitaActualizar = false;
                    if (proyectoIdExcel && !sesion.proyectoId) {
                        sesion.proyectoId = proyectoIdExcel;
                        necesitaActualizar = true;
                    }
                    if (!sesion.numeroTelefono || sesion.numeroTelefono !== lead.telefono) {
                        sesion.numeroTelefono = lead.telefono;
                        necesitaActualizar = true;
                    }
                    if (necesitaActualizar) {
                        await queryRunner.manager.save(sesion);
                    }
                }

                await queryRunner.commitTransaction();
                resultados.exitosos++;

                // 5. Envio de Primer Mensaje (Fuera de transaccion principal para no bloquear)
                try {
                    const yaEnviadoReciente = await this.historialService.haRecibidoMensajeReciente(
                        lead.id,
                        TipoPlantilla.PRIMER_CONTACTO,
                        1
                    );

                    if (!yaEnviadoReciente) {
                        const plantilla = await this.plantillasService.obtenerPlantillaPorTipo(TipoPlantilla.PRIMER_CONTACTO, codigoEmpresa);
                        if (plantilla) {
                            if (!plantilla.nombre) {
                                this.logger.error(`[Importacion] La plantilla ID ${plantilla.id} no tiene nombre configurado. No se puede enviar como Template.`);
                                continue;
                            }

                            // Obtener nombre del proyecto
                            let nombreProyecto = 'Nuestro Proyecto';
                            if (proyectoIdExcel) {
                                const proyecto = proyectosActivosPorId.get(proyectoIdExcel);
                                if (proyecto) nombreProyecto = proyecto.nombre || nombreProyecto;
                            }

                            // Reemplazar variables en contenido
                            let mensajeContenido = plantilla.contenido;
                            if (plantilla.parametros && Array.isArray(plantilla.parametros)) {
                                for (const param of plantilla.parametros) {
                                    const regex = new RegExp(`\\{\\{${param}\\}\\}`, 'g');
                                    switch (param) {
                                        case 'name':
                                            mensajeContenido = mensajeContenido.replace(regex, lead.nombre || 'Cliente');
                                            break;
                                        case 'project':
                                            mensajeContenido = mensajeContenido.replace(regex, nombreProyecto);
                                            break;
                                    }
                                }
                            }

                            // Construir components dinámicamente según parámetros de la plantilla
                            const nombreCliente = lead.nombre || 'Cliente';
                            const components = [];
                            if (plantilla.parametros && Array.isArray(plantilla.parametros) && plantilla.parametros.length > 0) {
                                const bodyParams = [];
                                for (const param of plantilla.parametros) {
                                    switch (param) {
                                        case 'name':
                                            bodyParams.push({ type: 'text', parameter_name: 'name', text: nombreCliente });
                                            break;
                                        case 'project':
                                            bodyParams.push({ type: 'text', parameter_name: 'project', text: nombreProyecto });
                                            break;
                                    }
                                }
                                if (bodyParams.length > 0) {
                                    components.push({ type: 'body', parameters: bodyParams });
                                }
                            }

                            this.logger.debug(`[Importacion] Components para Meta: ${JSON.stringify(components)}`);

                            const telefonoEnvio = lead.telefono;
                            this.logger.log(`[Importacion] Intentando enviar primer mensaje a Lead ID: ${lead.id}, Telefono: ${telefonoEnvio}`);

                            if (telefonoEnvio) {
                                try {
                                    this.logger.log(`[Importacion] Enviando a WAPI (Template)... CodigoEmpresa: ${codigoEmpresa}, Destino: ${telefonoEnvio}, Template: ${plantilla.nombre}`);

                                    const response: any = await this.wapiService.sendTemplate(
                                        codigoEmpresa,
                                        telefonoEnvio,
                                        plantilla.nombre,
                                        plantilla.idioma || 'es_PE',
                                        components
                                    );
                                    this.logger.log(`[Importacion] Respuesta WAPI: ${JSON.stringify(response)}`);

                                    let wamid = null;
                                    let estado = 'enviado';
                                    let errorDetails = null;

                                    if (response && response.error) {
                                        estado = 'fallido';
                                        errorDetails = response.details;
                                        this.logger.warn(`[Importacion] WAPI devolvió error: ${JSON.stringify(errorDetails)}`);
                                    } else {
                                        wamid = response?.messages?.[0]?.id || response?.id || null;
                                        if (!wamid) {
                                            // Si no hay error explícito pero tampoco ID, algo raro pasó
                                            this.logger.warn(`[Importacion] WAPI no devolvió ID ni error explícito.`);
                                        }
                                    }

                                    // Registrar en tbl_mensajes
                                    const nuevoMensaje = this.mensajeRepo.create({
                                        codigoEmpresa: codigoEmpresa,
                                        leadUuid: lead.uuid,
                                        idUsuario: null, // Sistema/Bot
                                        idEmisorTipo: 2, // 2 = Bot
                                        contenido: mensajeContenido,
                                        numeroTelefono: telefonoEnvio,
                                        tipoMultimedia: 'text',
                                        estadoMensaje: estado,
                                        wamidMsg: wamid ? String(wamid) : null,
                                        errorWapi: errorDetails, // Guardar el error de Meta
                                        leido: 0,
                                        conversacionFacturable: 0,
                                        fechaEnvio: new Date(),
                                        fechaCreacion: new Date()
                                    });
                                    await this.mensajeRepo.save(nuevoMensaje);

                                    this.logger.log(`[Importacion] Mensaje guardado en BD. ID: ${nuevoMensaje.id}, Estado: ${estado}`);

                                    await this.historialService.registrarEnvio(
                                        lead.id,
                                        TipoPlantilla.PRIMER_CONTACTO,
                                        plantilla.id,
                                        estado === 'enviado' ? 'ENVIADO' : 'FALLIDO',
                                        {
                                            origen: 'importacion_excel',
                                            proyectoId: proyectoIdExcel,
                                            wamid,
                                            mensajeId: nuevoMensaje.id,
                                            error: errorDetails
                                        }
                                    );

                                    // Registrar en tbl_historial_chat_ai solo si se envió (opcional, o registrar el intento fallido también?)
                                    // Usuario pidió contexto del bot, así que lo guardamos igual
                                    const historialAi = this.historialAiRepo.create({
                                        leadUuid: lead.uuid,
                                        codigoEmpresa: codigoEmpresa,
                                        input: { role: 'assistant', content: mensajeContenido },
                                        role: 'assistant',
                                        nombreModelo: 'importacion-sistema',
                                        metadatos: {
                                            origen: 'importacion_excel',
                                            wamid: wamid,
                                            mensaje_id: nuevoMensaje.id,
                                            status: estado,
                                            error: errorDetails
                                        }
                                    });
                                    await this.historialAiRepo.save(historialAi);
                                    this.logger.log(`[Importacion] Contexto AI guardado.`);
                                } catch (innerError) {
                                    this.logger.error(`[Importacion] Fallo al enviar/guardar mensaje a ${telefonoEnvio}: ${innerError.message}`, innerError.stack);
                                }
                            } else {
                                this.logger.warn(`[Importacion] No se pudo enviar mensaje: Telefono invalido o vacio para Lead ID ${lead.id}`);
                            }
                        } else {
                            this.logger.warn(`[Importacion] No se encontro plantilla de PRIMER_CONTACTO para empresa ${codigoEmpresa}`);
                        }
                    } else {
                        this.logger.log(`[Importacion] Lead ${lead.id} ya recibio PRIMER_CONTACTO en la ultima hora. Se omite reenvio.`);
                    }
                } catch (msgError) {
                    this.logger.error(`[Importacion] Error general en bloque de envio mensaje a ${lead.telefono}: ${msgError.message}`, msgError.stack);
                }

            } catch (err) {
                await queryRunner.rollbackTransaction();
                this.logger.error(`Error importando fila ${index}: ${err.message}`);
                resultados.fallidos++;
                resultados.errores.push({ fila: index + 1, error: err.message });
            } finally {
                await queryRunner.release();
            }
        }

        return resultados;
    }

    private resolverProyectoIdExcel(
        rawProjectId: unknown,
        proyectosActivosPorId: Map<number, Proyecto>,
        index: number,
    ): number | null {
        if (rawProjectId === undefined || rawProjectId === null || rawProjectId === '') {
            return null;
        }

        const proyectoId = Number(rawProjectId);
        if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
            throw new BadRequestException(`Fila ${index + 1}: el ID de proyecto "${rawProjectId}" no es válido.`);
        }

        if (!proyectosActivosPorId.has(proyectoId)) {
            throw new BadRequestException(`Fila ${index + 1}: el ID de proyecto ${proyectoId} no corresponde a un proyecto activo habilitado para esta empresa.`);
        }

        return proyectoId;
    }

    private validarFilasExcel(
        datosCrudos: any[],
        proyectosActivosPorId: Map<number, Proyecto>,
    ): void {
        for (const [index, fila] of datosCrudos.entries()) {
            const telefono = this.limpiarTelefono(fila.phone || fila.celular || fila.telefono);
            const email = fila.email || fila.correo;

            if (!telefono && !email) {
                throw new BadRequestException(`Fila ${index + 1}: debe incluir al menos un teléfono o un correo electrónico.`);
            }

            this.resolverProyectoIdExcel(
                fila.project_id,
                proyectosActivosPorId,
                index,
            );
        }
    }

    private limpiarTelefono(t: string): string {
        if (!t) return null;
        return String(t).replace(/[^0-9]/g, ''); // Solo numeros
    }

    private async buscarLead(telefono: string, email: string, codigoEmpresa: number, qr: any): Promise<Lead> {
        // Prioridad Telefono
        if (telefono) {
            const l = await qr.manager.findOne(Lead, { where: { telefono, codigoEmpresa } });
            if (l) return l;
        }
        // Secundario Email
        if (email) {
            const l = await qr.manager.findOne(Lead, { where: { email, codigoEmpresa } });
            if (l) return l;
        }
        return null;
    }
}
