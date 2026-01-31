import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Lead } from '../../inbox/entities/lead.entity';
import { Prospecto } from '../../inbox/entities/prospecto.entity';
import { ContextoLead } from '../../ia/entities/contexto-lead.entity';
import { OrigenDato } from '../../inbox/entities/origen-dato.entity';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';
import { ServicioExcel } from './excel.service';
import { WapiService } from '../../webhook_meta/wapi.service';
import { PlantillasService } from '../../plantillas/services/plantillas.service';
import { HistorialEnviosService } from '../../historial-envios/services/historial-envios.service';
import { TipoPlantilla } from '../../plantillas/entities/plantilla.entity';

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
        @InjectRepository(ContextoLead) private contextoRepo: Repository<ContextoLead>,
        @InjectRepository(OrigenDato) private origenRepo: Repository<OrigenDato>,
        @InjectRepository(SesionConversacion) private sesionRepo: Repository<SesionConversacion>,
        private readonly wapiService: WapiService,
        private readonly plantillasService: PlantillasService,
        private readonly historialService: HistorialEnviosService,
        @InjectRepository(Mensaje) private mensajeRepo: Repository<Mensaje>,
        @InjectRepository(HistorialChatAi) private historialAiRepo: Repository<HistorialChatAi>,
    ) { }

    async procesarArchivoExcel(buffer: Buffer, codigoEmpresa: number, proposito: string, nombreBd: string) {
        const datosCrudos = this.servicioExcel.leerBuffer(buffer);
        const resultados = {
            total: datosCrudos.length,
            exitosos: 0,
            fallidos: 0,
            errores: []
        };

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

                // 2. Crear Prospecto de Contexto
                const prospecto = new Prospecto();
                prospecto.lead = lead;
                prospecto.codigoEmpresa = codigoEmpresa;
                prospecto.origenId = origenExcel.id;
                prospecto.origenDato = 'Excel';
                prospecto.interesTipoId = fila.project_id ? Number(fila.project_id) : null;
                prospecto.interesNombre = 'Importacion Masiva ' + nombreBd;
                prospecto.estadoGestion = 'nuevo';
                prospecto.observacion = fila.observacion || null;

                // Guardar todos los datos en JSON_DATA
                const jsonData = { ...fila };
                prospecto.json_data = jsonData;

                await queryRunner.manager.save(prospecto);

                // 3. Primar Memoria IA (Contexto Lead)
                let contexto = await queryRunner.manager.findOne(ContextoLead, {
                    where: { leadUuid: lead.uuid, codigoEmpresa: codigoEmpresa }
                });

                if (!contexto) {
                    contexto = new ContextoLead();
                    contexto.leadUuid = lead.uuid;
                    contexto.codigoEmpresa = codigoEmpresa;
                }

                contexto.nombreCompleto = `${lead.nombre || ''} ${lead.apellido || ''}`.trim();

                // Actualizar proyectos de interes
                let proyectos = contexto.proyectosInteres || [];
                if (fila.project_id && !proyectos.includes(fila.project_id)) {
                    proyectos.push(fila.project_id);
                }
                contexto.proyectosInteres = proyectos;

                await queryRunner.manager.save(contexto);

                // 4. Crear Sesion de Conversacion
                let sesion = await queryRunner.manager.findOne(SesionConversacion, {
                    where: { leadUuid: lead.uuid, codigoEmpresa: codigoEmpresa }
                });

                if (!sesion) {
                    sesion = new SesionConversacion();
                    sesion.leadUuid = lead.uuid;
                    sesion.codigoEmpresa = codigoEmpresa;
                    sesion.proximoMensajeMinutos = 60;

                    await queryRunner.manager.save(sesion);
                }

                await queryRunner.commitTransaction();
                resultados.exitosos++;

                // 5. Envio de Primer Mensaje (Fuera de transaccion principal para no bloquear)
                try {

                    const yaEnviado = await this.mensajeRepo.findOne({
                        where: { leadUuid: lead.uuid }
                    });

                    // if (!yaEnviado) {
                    if (true) {
                        const plantilla = await this.plantillasService.obtenerPlantillaPorTipo(TipoPlantilla.PRIMER_CONTACTO, codigoEmpresa);
                        if (plantilla) {
                            let mensajeContenido = plantilla.contenido;
                            if (plantilla.parametros && plantilla.parametros.includes('name')) {
                                const nombreCliente = lead.nombre || 'Cliente';
                                mensajeContenido = mensajeContenido.replace('{{name}}', nombreCliente);
                            }

                            // Enviar Mensaje
                            const telefonoEnvio = lead.telefono;
                            this.logger.log(`[Importacion] Intentando enviar primer mensaje a Lead ID: ${lead.id}, Telefono: ${telefonoEnvio}`);

                            if (telefonoEnvio) {
                                try {
                                    // WapiService.sendMessage might be void or return object. Adjusting to safe call.
                                    this.logger.log(`[Importacion] Enviando a WAPI... CodigoEmpresa: ${codigoEmpresa}, Destino: ${telefonoEnvio}`);
                                    const response: any = await this.wapiService.sendMessage(codigoEmpresa, telefonoEnvio, mensajeContenido);
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
                        this.logger.log(`[Importacion] Lead ${lead.id} ya tiene mensaje de primer contacto registrado.`);
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
