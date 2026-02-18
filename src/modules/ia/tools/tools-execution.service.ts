import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CitasService } from '../../citas/citas.service';
import { ConfigService } from '@nestjs/config';
import { QdrantVectorService } from '../qdrant-vector.service';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { ProjectsSearchService } from '../projects-search.service';
import { WapiService } from '../../webhook_meta/wapi.service';
import { InboxService } from '../../inbox/inbox.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { SesionConversacion } from '../entities/sesion-conversacion.entity';
import { HistorialClasificacionLead } from '../../clasificacion-leads/entities/historial-clasificacion-lead.entity';
import { Lead } from '../../inbox/entities/lead.entity';
import { ResumenConversacionService } from '../resumen-conversacion.service';
import { Proyecto } from '../../proyectos/entities/proyecto.entity';

@Injectable()
export class ToolsExecutionService {
    private readonly logger = new Logger(ToolsExecutionService.name);
    private llm: ChatOpenAI;

    constructor(
        private citasService: CitasService,
        private configService: ConfigService,
        private qdrantVectorService: QdrantVectorService,
        private projectsSearchService: ProjectsSearchService,
        private wapiService: WapiService,
        private inboxService: InboxService,
        @InjectRepository(SesionConversacion) private sesionRepo: Repository<SesionConversacion>,
        @InjectRepository(HistorialClasificacionLead) private clasificacionRepo: Repository<HistorialClasificacionLead>,
        @InjectRepository(Lead) private leadRepo: Repository<Lead>,
        @InjectRepository(Proyecto) private proyectosRepo: Repository<Proyecto>,
        private resumenService: ResumenConversacionService,
    ) {
        // LLM para el RAG Chain
        this.llm = new ChatOpenAI({
            modelName: 'gpt-4o-mini',
            temperature: 0,
            openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
        });
    }

    /**
     * Convierte URL de Google Drive (view) a URL directa de imagen
     * Ejemplo: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
     * A: https://drive.google.com/uc?export=view&id=FILE_ID
     */
    private convertGoogleDriveToDirectUrl(driveUrl: string): string | null {
        if (!driveUrl || !driveUrl.includes('drive.google.com')) {
            return null;
        }

        // Extraer FILE_ID de la URL
        const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
            const fileId = match[1];
            return `https://drive.google.com/uc?export=view&id=${fileId}`;
        }

        return null;
    }



    /**
     * Actualiza datos del lead SOLO si los campos están vacíos
     * Previene sobrescribir información existente
     * @param leadUuid UUID del lead
     * @param codigoEmpresa Código de empresa
     * @param datos Datos a actualizar (solo se actualizan campos vacíos)
     */
    private async actualizarLeadSeguro(
        leadUuid: string,
        codigoEmpresa: number,
        datos: {
            nombre?: string;
            apellido?: string;
            dni?: string;
            email?: string;
        }
    ): Promise<void> {
        try {
            // 1. Obtener lead actual
            const lead = await this.leadRepo.findOne({
                where: { uuid: leadUuid, codigoEmpresa }
            });

            if (!lead) {
                this.logger.warn(`Lead no encontrado: ${leadUuid}`);
                return;
            }

            // 2. Construir objeto de actualización
            // nombre/apellido: siempre sobrescribir si viene dato nuevo (nombre real del cliente)
            // dni/email: solo si está vacío (previene sobrescritura accidental)
            const updateData: any = {};

            if (datos.nombre) {
                updateData.nombre = datos.nombre.trim();
            }

            if (datos.apellido) {
                updateData.apellido = datos.apellido.trim();
            }

            if (datos.dni && !lead.dni) {
                updateData.dni = datos.dni.trim();
            }

            if (datos.email && !lead.email) {
                updateData.email = datos.email.trim().toLowerCase();
            }

            // 3. Actualizar solo si hay cambios
            if (Object.keys(updateData).length > 0) {
                await this.leadRepo.update(
                    { uuid: leadUuid, codigoEmpresa },
                    updateData
                );

                const camposActualizados = Object.keys(updateData).join(', ');

                // 4. Registrar en resumen de conversación
                const puntosResumen: string[] = [];
                if (updateData.nombre || updateData.apellido) {
                    const nombreCompleto = `${updateData.nombre || ''} ${updateData.apellido || ''}`.trim();
                    puntosResumen.push(`Identificado: ${nombreCompleto}`);
                }
                if (updateData.dni) {
                    puntosResumen.push(`DNI capturado: ${updateData.dni}`);
                }
                if (updateData.email) {
                    puntosResumen.push(`Email registrado: ${updateData.email}`);
                }

                if (puntosResumen.length > 0) {
                    await this.resumenService.agregarPuntos(leadUuid, codigoEmpresa, puntosResumen);
                }
            } else {
                this.logger.debug(`ℹ Lead ${leadUuid} ya tiene todos los datos proporcionados, no se actualiza`);
            }
        } catch (error) {
            this.logger.error(`Error actualizando lead seguro: ${error.message}`);
            // No lanzamos error para no interrumpir el flujo
        }
    }

    /*
     * Nueva herramienta inteligente para búsqueda de propiedades
     * Integra análisis de requisitos y búsqueda híbrida
     */
    async buscarPropiedadesInteligente(params: { input_usuario: string }, context?: any) {
        try {
            this.logger.log(`🔍 Búsqueda Inteligente: "${params.input_usuario}"`);

            // Usamos el servicio especializado
            const resultado = await this.projectsSearchService.searchProperties(
                params.input_usuario,
                5, // Limit 5
                context
            );

            const { results, filters_applied } = resultado;

            if (results.length === 0) {
                return "[ACCION_COMPLETADA] No encontre propiedades con esas caracteristicas especificas. <<INSTRUCCION_IA: Pregunta si quiere ver otras opciones similares.>>";
            }

            // Formatear respuesta para el LLM final
            const contextText = results.map((d: any, i: number) => {
                const m = d.metadata;
                // Validacion temporal para promos
                const fechaLimite = new Date('2025-01-01');
                const mostrarPromos = new Date() < fechaLimite;

                let precioStr = `- Precio: ${m.currency || 'S/'} ${m.price_list}`;
                if (mostrarPromos && m.price_promo) {
                    precioStr = `- Precio: ${m.currency || 'S/'} ${m.price_promo} (Antes: ${m.price_list})`;
                }

                return `OPCION ${i + 1}:
- Proyecto: ${m.project_name}
- Unidad: ${m.unit_number} (${m.type || 'Depa'})
${precioStr}
- Dormitorios: ${m.bedrooms}
- Piso: ${m.floor} (${m.view})
- Area: ${m.area_total}m2
- Disponibilidad: ${m.availability}
- Link Plano: ${m.url_plano}
- Ubicacion: ${m.url_ubicacion}
`;
            }).join('\n');

            return `[ACCION_COMPLETADA] Encontre estas opciones que coinciden con tu busqueda (Filtros: ${JSON.stringify(filters_applied)}):\n\n${contextText}`;

        } catch (error) {
            this.logger.error(`Error en búsqueda inteligente: ${error.message}`);
            return "Tuve un problema buscando las propiedades. Por favor intenta de nuevo.";
        }
    }

    /**
     * Valida fecha y hora para agendamiento de citas
     * Retorna objeto con {valid: boolean, mensaje?: string}
     */
    private validarFechaHoraCita(fecha_cita: string, hora_cita: string): { valid: boolean; mensaje?: string } {
        const ahoraPeru = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
        const hoyISO = `${ahoraPeru.getFullYear()}-${String(ahoraPeru.getMonth() + 1).padStart(2, '0')}-${String(ahoraPeru.getDate()).padStart(2, '0')}`;

        // 1. Validar que la fecha no sea pasada
        if (fecha_cita < hoyISO) {
            return {
                valid: false,
                mensaje: `La fecha ${fecha_cita} ya pasó. Solo puedo agendar citas para hoy o fechas futuras.`
            };
        }

        // 2. Si es hoy, validar que la hora no haya pasado (margen de 0 min)
        if (fecha_cita === hoyISO) {
            const horaActualMin = ahoraPeru.getHours() * 60 + ahoraPeru.getMinutes();
            const [hCita, mCita] = hora_cita.split(':').map(Number);
            const horaCitaMin = hCita * 60 + mCita;

            if (horaCitaMin < horaActualMin) {
                const horaActualStr = `${String(ahoraPeru.getHours()).padStart(2, '0')}:${String(ahoraPeru.getMinutes()).padStart(2, '0')}`;
                return {
                    valid: false,
                    mensaje: `La hora ${hora_cita} ya pasó (ahora son las ${horaActualStr}). Elige una hora a partir de las ${horaActualStr} en adelante.`
                };
            }
        }

        // 3. Validar horario de atención: 10:00 a 19:00
        const [horaNum, minNum] = hora_cita.split(':').map(Number);
        const minutosDelDia = horaNum * 60 + minNum;
        const HORA_APERTURA = 10 * 60; // 10:00 = 600 min
        const HORA_CIERRE = 19 * 60;   // 19:00 = 1140 min

        if (minutosDelDia < HORA_APERTURA || minutosDelDia >= HORA_CIERRE) {
            return {
                valid: false,
                mensaje: `El horario de atención es de 10:00 a.m. a 7:00 p.m. La hora ${hora_cita} está fuera de horario. ¿Podrías elegir otro horario dentro de ese rango?`
            };
        }

        return { valid: true };
    }

    async agendarCita(params: any, codigoEmpresa: number, leadUuid: string) {
        this.logger.log(`Intentando agendar cita: ${JSON.stringify(params)}`);

        const { fecha_cita, hora_cita, nombre_proyecto, tipo_cita, email, unidad_interes, dormitorios, precio_referencial } = params;

        // Validar y normalizar tipo de cita (PRESENCIAL por defecto)
        const tipoCitaNormalizado = tipo_cita?.toUpperCase() === 'VIRTUAL' ? 'VIRTUAL' : 'PRESENCIAL';

        // === VALIDACIONES DE FECHA Y HORA ===
        const validacion = this.validarFechaHoraCita(fecha_cita, hora_cita);
        if (!validacion.valid) {
            return { success: false, mensaje: validacion.mensaje };
        }

        // Actualizar email si lo proporciona
        if (email && leadUuid && codigoEmpresa) {
            await this.actualizarLeadSeguro(leadUuid, codigoEmpresa, { email });
        }

        // Validar si ya tiene una cita ACTIVA FUTURA
        const ultimaCita = await this.citasService.obtenerUltimaCitaPorLead(leadUuid, codigoEmpresa);

        if (ultimaCita) {
            const fechaCitaExistente = new Date(`${ultimaCita.fechaCita}T${ultimaCita.horaCita}`);
            const ahora = new Date();
            const citaEsFutura = fechaCitaExistente > ahora;
            const citaEsActiva = ultimaCita.estadoCita === 'pendiente' || ultimaCita.estadoCita === 'confirmada';

            if (citaEsActiva && citaEsFutura) {
                return {
                    success: false,
                    mensaje: `Ya tienes una cita programada para el ${ultimaCita.fechaCita} a las ${ultimaCita.horaCita}. Si deseas reagendarla, dime la nueva fecha y hora.`
                };
            }
        }

        // Validar disponibilidad del horario (excluyendo al mismo lead)
        const ocupado = await this.citasService.existeCitaEnHorario(fecha_cita, hora_cita, codigoEmpresa, leadUuid);

        if (ocupado) {
            return {
                success: false,
                mensaje: `Lo siento, el horario de las ${hora_cita} para el día ${fecha_cita} ya está ocupado. ¿Podrías elegir otro horario?`
            };
        }

        // Construir observación detallada
        let observacion = `Proyecto interés: ${nombre_proyecto} | Tipo: ${tipoCitaNormalizado}`;
        if (unidad_interes) observacion += ` | Unidad: ${unidad_interes}`;
        if (dormitorios) observacion += ` | Dorms: ${dormitorios}`;
        if (precio_referencial) observacion += ` | Precio: S/${precio_referencial}`;

        // Crear Cita
        await this.citasService.crearCita({
            codigoEmpresa,
            leadUuid: leadUuid,
            fechaCita: fecha_cita,
            horaCita: hora_cita,
            tipoCita: tipoCitaNormalizado,
            observacion: observacion,
            estadoCita: 'pendiente'
        });

        // Actualizar Estado Sesion y Clasificacion
        try {
            const sesion = await this.sesionRepo.findOne({ where: { leadUuid, codigoEmpresa } });
            if (sesion) {
                sesion.idEstado = 2;
                await this.sesionRepo.save(sesion);

                const historial = this.clasificacionRepo.create({
                    idSesion: sesion.id,
                    clasificacion: 'alto',
                    razon: 'Agendó cita satisfactoriamente',
                });
                await this.clasificacionRepo.save(historial);
                this.logger.log(`[AgendarCita] Lead clasificado como ALTO y Sesion actualizada a estado 2`);
            }
        } catch (err) {
            this.logger.error(`[AgendarCita] Error actualizando clasificacion: ${err.message}`);
        }


        let direccion = '';
        let mapaUrl = '';

        try {
            const proyectoDb = await this.proyectosRepo.findOne({
                where: { nombre: ILike(`%${nombre_proyecto}%`), codigoEmpresa }
            });

            let proyectoFinal = proyectoDb;

            if (!proyectoFinal) {
                const palabras = nombre_proyecto.split(' ').filter((p: string) => p.length > 3);
                if (palabras.length > 0) {
                    proyectoFinal = await this.proyectosRepo.findOne({
                        where: palabras.map((p: string) => ({ nombre: ILike(`%${p}%`), codigoEmpresa }))
                    });
                }
            }

            this.logger.log(`[AgendarCita] Proyecto buscado: "${nombre_proyecto}" -> Encontrado: ${proyectoFinal?.nombre || 'NO'}`);

            if (proyectoFinal) {
                let foundInJson = false;
                if (proyectoFinal.jsonData && proyectoFinal.jsonData['direccion_sala_ventas']) {
                    direccion = proyectoFinal.jsonData['direccion_sala_ventas'];
                    foundInJson = true;
                }


                if (!foundInJson && proyectoFinal.ubicacion) {
                    const ubicacionRaw = proyectoFinal.ubicacion;
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    const match = ubicacionRaw.match(urlRegex);

                    if (match) {
                        mapaUrl = match[0];
                        let cleanAddr = ubicacionRaw.replace(urlRegex, '').replace(/Google Maps:?/i, '').trim();
                        cleanAddr = cleanAddr.replace(/^[:\-\s]+|[:\-\s]+$/g, '');

                        if (cleanAddr.length > 3) {
                            direccion = cleanAddr;
                        }
                    } else {
                        direccion = ubicacionRaw;
                        const encodedAddress = encodeURIComponent(direccion);
                        mapaUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
                    }
                }
            }
        } catch (e) {
            this.logger.error(`Error buscando proyecto para ubicacion: ${e.message}`);
        }

        const tipoTexto = tipoCitaNormalizado === 'VIRTUAL' ? 'videollamada virtual' : 'visita presencial';

        let outputMsg = `[ACCION_COMPLETADA] Cita ${tipoTexto} AGENDADA EXITOSAMENTE.
        
DATOS DE LA CITA:
- 📅 Fecha: ${fecha_cita}
- 🕐 Hora: ${hora_cita}
- 👥 Tipo: ${tipoCitaNormalizado}`;

        if (direccion) {
            outputMsg += `\n- 📍 Dirección: ${direccion}`;
        }
        if (mapaUrl) {
            outputMsg += `\n- Link Mapa: ${mapaUrl}`;
        }

        outputMsg += `\n\nTe esperamos para que conozcas el departamento y resolvamos cualquier duda en persona.`;

        if (!direccion && !mapaUrl) {
            outputMsg += ` Te enviaré la ubicación exacta más adelante.`;
        }

        return {
            success: true,
            mensaje: outputMsg
        };
    }

    /**
     * Reagenda una cita existente - Solo actualiza lo que el cliente quiere cambiar
     */
    async reagendarCita(params: any, codigoEmpresa: number, leadUuid: string) {
        this.logger.log(`[ReagendarCita] Params: ${JSON.stringify(params)}`);

        const { tipo_cita_nuevo, fecha_nueva, hora_nueva, motivo_cambio } = params;

        // 1. VALIDACIÓN CRÍTICA: Obtener cita actual
        const citaActual = await this.citasService.obtenerUltimaCitaPorLead(leadUuid, codigoEmpresa);

        if (!citaActual) {
            this.logger.error(`[ReagendarCita] ERROR: No existe cita previa para lead ${leadUuid}`);
            return {
                success: false,
                mensaje: "ERROR INTERNO: No puedes reagendar porque NO TIENES ninguna cita agendada. Esta herramienta solo se usa cuando YA existe una cita."
            };
        }

        // 2. Validar estado de la cita
        if (citaActual.estadoCita === 'cancelada' || citaActual.estadoCita === 'realizada') {
            this.logger.warn(`[ReagendarCita] Cita ya está ${citaActual.estadoCita}`);
            return {
                success: false,
                mensaje: `Tu cita anterior está ${citaActual.estadoCita}. Si quieres, puedo agendar una nueva.`
            };
        }

        this.logger.log(`[ReagendarCita] Cita actual encontrada: ${citaActual.fechaCita} ${citaActual.horaCita}`);

        // 3. Preparar datos a actualizar (solo lo que cambió)
        const datosActualizacion: any = {};
        const cambios: string[] = [];

        // Tipo de cita
        if (tipo_cita_nuevo) {
            const tipoNormalizado = tipo_cita_nuevo.toUpperCase();
            if (citaActual.tipoCita !== tipoNormalizado) {
                datosActualizacion.tipoCita = tipoNormalizado;
                cambios.push(`tipo de ${citaActual.tipoCita} a ${tipoNormalizado}`);
            }
        }

        const fechaFinal = fecha_nueva || citaActual.fechaCita;
        const horaFinal = hora_nueva || citaActual.horaCita;

        if (fecha_nueva || hora_nueva) {
            const validacion = this.validarFechaHoraCita(fechaFinal, horaFinal);
            if (!validacion.valid) {
                return { success: false, mensaje: validacion.mensaje };
            }

            const ocupado = await this.citasService.existeCitaEnHorario(fechaFinal, horaFinal, codigoEmpresa, leadUuid);
            if (ocupado) {
                return {
                    success: false,
                    mensaje: `El horario ${horaFinal} del ${fechaFinal} ya está ocupado. Elige otro.`
                };
            }

            if (fecha_nueva) {
                datosActualizacion.fechaCita = fecha_nueva;
                cambios.push(`fecha a ${fecha_nueva}`);
            }
            if (hora_nueva) {
                datosActualizacion.horaCita = hora_nueva;
                cambios.push(`hora a ${hora_nueva}`);
            }
        }

        if (motivo_cambio) {
            const obsBase = citaActual.observacion?.split(' | Reagendada:')[0] || citaActual.observacion || '';
            datosActualizacion.observacion = `${obsBase} | Reagendada: ${motivo_cambio}`.trim();
        }

        // Si no hay cambios reales, no hacer nada
        if (Object.keys(datosActualizacion).length === 0) {
            this.logger.log(`[ReagendarCita] No hay cambios que realizar`);
            return {
                success: true,
                mensaje: `Tu cita ya está programada para el ${fechaFinal} a las ${horaFinal}. No hay cambios que realizar.`
            };
        }

        this.logger.log(`[ReagendarCita] Actualizando cita ID ${citaActual.id} con: ${JSON.stringify(datosActualizacion)}`);
        await this.citasService.reagendarCita(citaActual.id, datosActualizacion);

        const tipoFinal = datosActualizacion.tipoCita || citaActual.tipoCita;
        const tipoTexto = tipoFinal === 'VIRTUAL' ? 'virtual' : 'presencial';

        return {
            success: true,
            mensaje: `[ACCION_COMPLETADA] Listo, actualicé tu cita ${cambios.length > 0 ? `(${cambios.join(', ')})` : ''}. Ahora es ${tipoTexto} para el ${fechaFinal} a las ${horaFinal}.`
        };
    }

    /**     
     * - Gestión automática de embeddings
     * - Retry automático en errores
     * - Logs integrados
     * - Compatible con cualquier VectorStore (no solo Qdrant)
     */
    /**
     * Gestión de Preguntas Frecuentes (FAQs) y Datos Generales del Proyecto
     * Busca en la colección de documentos/FAQs (NO en inventario de departamentos)
     */
    async buscarPreguntasFrecuentes(params: any) {
        try {
            const { queries_de_busqueda, nombre_proyecto } = params;
            this.logger.log(`Buscando FAQ: ${queries_de_busqueda.join(', ')} en ${nombre_proyecto}`);

            const queryPrincipal = queries_de_busqueda[0];
            // Colección de Documentos/FAQs (texto)
            const collectionName = this.configService.get<string>('QDRANT_COLLECTION_NAME', 'checor-los-lirios-e2c76d6a');

            // Threshold más alto para evitar ruido
            const docs = await this.qdrantVectorService.similaritySearch(collectionName, queryPrincipal, 3);

            const contexto = docs.map(d => {
                const meta = d.metadata || {};

                // Prioridad 1: Formato FAQ explícito
                if (meta.pregunta && meta.respuesta) {
                    return `PREGUNTA FRECUENTE (Oficial):\nP: ${meta.pregunta}\nR: ${meta.respuesta}\n(Prioridad Alta)`;
                }

                // Contenido general
                if (meta.content) return meta.content;
                return d.pageContent || meta.text || '';
            }).filter(c => c.trim()).join("\n\n---\n\n");

            this.logger.log(`FAQ RAG - Docs encontrados: ${docs.length}`);
            this.logger.debug(`Contexto FAQ: ${contexto}`);

            if (!contexto.trim()) {
                return "Lo siento, no tengo esa información específica en mi base de datos de preguntas frecuentes.";
            }

            const promptTemplate = ChatPromptTemplate.fromTemplate(`
Eres el asistente oficial del proyecto inmobiliario. Tu única fuente de verdad es el siguiente CONTEXTO.

CONTEXTO RECUPERADO DE BASE DE DATOS:
{context}

PREGUNTA DEL USUARIO: {question}

INSTRUCCIONES OBLIGATORIAS:
1. Responde SOLO basándote en el Contexto.
2. Si el contexto dice "No contamos con...", tu respuesta debe ser "No contamos con...". NO inventes que sí hay.
3. Si hay una sección marcada como "PREGUNTA FRECUENTE (Oficial)", esa es la respuesta definitiva.
4. No menciones "según la base de datos", responde natural como si tú supieras.
5. Si no hay información en el contexto, di "No tengo información sobre eso".

RESPUESTA PRECISA:`);

            const chain = RunnableSequence.from([
                promptTemplate,
                this.llm,
                new StringOutputParser(),
            ]);

            const resultado = await chain.invoke({
                context: contexto,
                question: queryPrincipal,
            });

            this.logger.debug(`Respuesta LLM FAQ: ${resultado}`);

            if (!resultado || resultado.toLowerCase().includes("no encontré") || resultado.toLowerCase().includes("no tengo información")) {
                return "[ACCION_COMPLETADA] No encontre informacion sobre eso en mis registros. <<INSTRUCCION_IA: Continua la conversacion con naturalidad.>>";
            }

            return `[ACCION_COMPLETADA] ${resultado}`;

        } catch (error) {
            this.logger.error(`Error en buscarPreguntasFrecuentes: ${error.message}`);
            return "Hubo un error consultando las preguntas frecuentes.";
        }
    }

    async validarDni(params: { dni: string; leadUuid?: string; codigoEmpresa?: number }) {
        const { dni, leadUuid, codigoEmpresa } = params;

        // Validaciones
        if (!dni || dni.length !== 8) {
            return { success: false, mensaje: "El DNI debe tener exactamente 8 dígitos." };
        }

        if (!/^\d{8}$/.test(dni)) {
            return { success: false, mensaje: "El DNI solo debe contener números." };
        }

        if (dni === '00000000' || dni.startsWith('00')) {
            return { success: false, mensaje: "DNI invalido. Por favor verifica el numero." };
        }

        //  Actualizar lead en BD si tenemos contexto (solo si está vacío)
        if (leadUuid && codigoEmpresa) {
            await this.actualizarLeadSeguro(leadUuid, codigoEmpresa, { dni });
        }

        return { success: true, mensaje: "[ACCION_COMPLETADA] DNI validado correctamente. <<INSTRUCCION_IA: Continua con el siguiente paso del flujo.>>" };
    }

    async buscarPorCuota(params: { cuota_mensual: number }) {
        try {
            this.logger.log(`Buscando por cuota mensual: S/${params.cuota_mensual}`);

            // Calcular precio máximo aproximado usando la fórmula inversa
            // cuota_mensual ≈ precio_total / 200 (aproximación)
            const precioMaxAprox = params.cuota_mensual * 200;

            this.logger.log(`Precio máximo estimado: S/${precioMaxAprox}`);

            const collectionName = this.configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'checor-projects-v1';

            const queryText = `departamentos disponibles precio hasta ${precioMaxAprox} soles`;

            const filters: any = {
                precioMax: precioMaxAprox,
                disponible: true
            };

            const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                queryText,
                filters,
                { limit: 5, threshold: 0.5 }
            );

            this.logger.log(`Resultados por cuota: ${resultados.length} departamentos`);

            if (resultados.length === 0) {
                return JSON.stringify({
                    success: false,
                    mensaje: `No encontré departamentos que se ajusten a una cuota de S/${params.cuota_mensual}. ¿Podrías aumentar tu presupuesto o considerar otra opción?`
                });
            }

            // Formatear resultados con cálculo de cuota aproximada
            const datos = resultados.map((r: any) => {
                const m = r.metadata;
                const fechaLimite = new Date('2025-01-01');
                const mostrarPromos = new Date() < fechaLimite;

                const pListNum = parseFloat(m.price_list?.replace(/[^0-9.]/g, '') || '0');
                const pPromoNum = parseFloat(m.price_promo?.replace(/[^0-9.]/g, '') || '0');

                // Si NO mostramos promos, usamos pListNum como base
                let precioBase = pListNum;
                if (mostrarPromos && pPromoNum > 0) {
                    precioBase = pPromoNum;
                } else if (!mostrarPromos) {
                    precioBase = pListNum;
                } else {
                    precioBase = pPromoNum || pListNum;
                }

                const cuotaAprox = Math.round(precioBase / 200); // Aproximación simple

                return {
                    unidad: m.unit_number,
                    dormitorios: m.bedrooms,
                    area: m.area_total,
                    piso: m.floor,
                    precio_lista: m.price_list,
                    precio_promo: mostrarPromos ? m.price_promo : null,
                    cuota_aprox: cuotaAprox,
                    disponibilidad: m.availability,
                    vista: m.view
                };
            });

            return JSON.stringify({
                success: true,
                cuota_solicitada: params.cuota_mensual,
                datos: datos,
                nota: "Las cuotas son aproximadas. Para una cotización exacta, necesitamos más detalles."
            });

        } catch (error) {
            this.logger.error(`Error buscando por cuota: ${error.message}`);
            return JSON.stringify({
                success: false,
                mensaje: "Hubo un error al buscar departamentos por cuota. Por favor intenta de nuevo."
            });
        }
    }

    async mostrarDepartamentos(params: { dormitorios?: number, piso?: number }) {
        try {
            this.logger.log(`Buscando departamentos - Dormitorios: ${params.dormitorios}, Piso: ${params.piso}`);

            const collectionName = this.configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'checor-projects-v1';

            let queryText = 'departamento disponible';
            if (params.dormitorios) {
                queryText += ` ${params.dormitorios} dormitorios`;
            }
            if (params.piso) {
                queryText += ` piso ${params.piso}`;
            }

            const filters: any = {};
            if (params.dormitorios !== undefined) {
                filters.dormitorios = params.dormitorios;
            }
            if (params.piso !== undefined) {
                filters.pisoMin = params.piso;
                filters.pisoMax = params.piso;
            }

            const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                queryText,
                filters,
                { limit: 10, threshold: 0.5 }
            );

            this.logger.log(`Resultados encontrados: ${resultados.length} departamentos`);

            if (resultados.length === 0) {
                this.logger.warn(`No se encontraron resultados para dormitorios: ${params.dormitorios}`);
                return "[ACCION_COMPLETADA] No encontre departamentos disponibles con esas caracteristicas. <<INSTRUCCION_IA: Pregunta si quiere ver otras opciones.>>";
            }
            // Mostrar lista de resultados
            const lista = resultados.map((r, idx) => {
                const m = r.document.metadata;

                // Formatear precios
                const pList = m.price_list ? parseFloat(m.price_list) : 0;
                const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;

                // Validacion temporal: Ocultar promos si la fecha actual > 2025
                const fechaLimite = new Date('2025-01-01');
                const mostrarPromos = new Date() < fechaLimite;

                let precioMostrar = '';
                if (mostrarPromos && pPromo && pPromo < pList) {
                    precioMostrar = `S/${pList.toLocaleString('es-PE')} -> **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
                } else {
                    precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
                }

                const dormitoriosText = m.bedrooms === 0 ? 'Monoambiente' : `${m.bedrooms} dormitorio${m.bedrooms > 1 ? 's' : ''}`;

                return `${idx + 1}. Unidad ${m.unit_number} - ${dormitoriosText}, ${m.area_total}m² - Precio: ${precioMostrar}`;
            }).join('\n');

            const respuesta = `[ACCION_COMPLETADA] Hay ${resultados.length} departamento${resultados.length > 1 ? 's' : ''} disponible${resultados.length > 1 ? 's' : ''}:\n\n${lista}\n\n<<INSTRUCCION_IA: Pregunta si quiere agendar visita.>>`;

            return respuesta;

        } catch (error) {
            this.logger.error(`>>> ERROR en mostrarDepartamentos: ${error.message}`, error.stack);
            return "Ocurrio un error al buscar departamentos. Por favor intenta nuevamente en un momento.";
        }
    }

    async generarProforma(params: {
        nombre_cliente?: string;
        dni?: string;
        ocupacion?: string;
        ingresos?: string;
        unidad?: string;
        precio?: string;
        dormitorios?: number;
        area?: string;
        piso?: number;
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            this.logger.log(`Generando proforma para: ${params.nombre_cliente}`);

            const ocupacionCorregida = await this.corregirOcupacion(params.ocupacion);
            const ingresosFormateados = this.formatearMonto(params.ingresos);
            const precioFormateado = this.formatearMonto(params.precio);

            if (params.leadUuid && params.codigoEmpresa && params.nombre_cliente) {
                const nombreCompleto = params.nombre_cliente.trim();
                const partes = nombreCompleto.split(' ');

                const datos: any = {};
                if (partes.length >= 2) {
                    datos.nombre = partes[0];
                    datos.apellido = partes.slice(1).join(' ');
                } else {
                    datos.nombre = nombreCompleto;
                }

                await this.actualizarLeadSeguro(params.leadUuid, params.codigoEmpresa, datos);
            }

            // Capturar datos del cliente en el resumen (con ocupación corregida)
            if (params.leadUuid && params.codigoEmpresa) {
                const puntos: string[] = [];
                if (ocupacionCorregida) puntos.push(`Ocupación: ${ocupacionCorregida}`);
                if (params.ingresos) puntos.push(`Ingresos mensuales: ${ingresosFormateados}`);
                if (params.unidad && params.precio) {
                    puntos.push(`Cotizó unidad ${params.unidad} (${params.dormitorios || '?'} dorms, ${precioFormateado})`);
                }

                if (puntos.length > 0) {
                    await this.resumenService.agregarPuntos(params.leadUuid, params.codigoEmpresa, puntos);
                }
            }

            // Construir resumen formateado (sin emojis)
            const resumen = `RESUMEN DE TU COTIZACION\n\n` +
                `DATOS DEL CLIENTE:\n` +
                `. Nombre: ${params.nombre_cliente || 'N/A'}\n` +
                `. DNI: ${params.dni || 'N/A'}\n` +
                `. Ocupación: ${ocupacionCorregida || 'N/A'}\n` +
                `. Ingresos: ${ingresosFormateados}\n\n` +
                `DETALLES DEL DEPARTAMENTO:\n` +
                `. Unidad: ${params.unidad || 'N/A'}\n` +
                `. Dormitorios: ${params.dormitorios || 'N/A'}\n` +
                `. Área: ${params.area || 'N/A'}\n` +
                `. Piso: ${params.piso || 'N/A'}\n` +
                `. Precio: ${precioFormateado}\n\n`;

            if (params.phoneNumber && params.codigoEmpresa) {
                const response: any = await this.wapiService.sendMessage(params.codigoEmpresa, params.phoneNumber, resumen);
                this.logger.log(`Proforma enviada a ${params.phoneNumber}`);

                let wamid = null;
                let estado = 'enviado';
                let errorDetails = null;

                if (response && response.error) {
                    estado = 'fallido';
                    errorDetails = response.details;
                } else {
                    wamid = response?.messages?.[0]?.id || response?.id || null;
                }

                // Guardar en Inbox si hay UUID
                if (params.leadUuid) {
                    await this.inboxService.guardarMensajeBot({
                        leadUuid: params.leadUuid,
                        codigoEmpresa: params.codigoEmpresa,
                        contenido: resumen,
                        wamid: wamid,
                        estadoMensaje: estado,
                        errorWapi: errorDetails
                    });
                }
            }

            return `[ACCION_COMPLETADA] Proforma generada y enviada al cliente por WhatsApp. <<INSTRUCCION_IA: Dile que ya se la enviaste y pregunta si quiere ver el recorrido virtual.>>`;

        } catch (error) {
            this.logger.error(`Error generando proforma: ${error.message}`);
            return "Hubo un problema al generar la proforma. Por favor intenta de nuevo.";
        }
    }


    /**
     * HERRAMIENTA UNIVERSAL MEJORADA: Busca departamentos con estrategia de FALLBACK (rebote)
     * Si no encuentra exacto, relaja filtros progresivamente para siempre dar opciones.
     */
    async buscarDepartamentoUniversal(params: {
        unidad?: string;
        dormitorios?: number | string | (number | string)[];
        piso?: number;
        precio_max?: number;
        precio_min?: number;
        vista?: string;
        tipologia?: string;
        tipo_unidad?: string;
        area_min?: number;
        preferencia_piso?: 'bajos' | 'altos';
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            const collectionName = this.configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'checor-projects-v1';
            const logPrefix = `[BusquedaUniversal]`;

            this.logger.log(`${logPrefix} Params: ${JSON.stringify(params)}`);

            // Capturar preferencias del cliente en el resumen
            if (params.leadUuid && params.codigoEmpresa) {
                const puntos: string[] = [];
                const d = params.dormitorios;
                const dormsArray = Array.isArray(d) ? d : [d];
                const dormsStr = dormsArray.map(val => {
                    if (typeof val === 'string' && val.toLowerCase().includes('mono')) return 'Monoambiente';
                    if (val === 0) return 'Monoambiente';
                    return val;
                }).join(' y ');

                if (d) puntos.push(`Busca depa de ${dormsStr} dormitorio(s)`);
                if (params.precio_max) puntos.push(`Presupuesto maximo: S/${params.precio_max.toLocaleString('es-PE')}`);
                if (params.vista) puntos.push(`Prefiere vista ${params.vista}`);
                if (params.piso) puntos.push(`Interesado en piso ${params.piso}`);
                if (params.tipo_unidad) puntos.push(`Busca tipo: ${params.tipo_unidad}`);

                if (puntos.length > 0) {
                    await this.resumenService.agregarPuntos(params.leadUuid, params.codigoEmpresa, puntos);
                }
            }

            // --- CASO 1: BUSQUEDA POR UNIDAD ESPECIFICA (Prioridad Maxima) ---
            if (params.unidad) {
                if (params.leadUuid && params.codigoEmpresa) {
                    await this.resumenService.agregarPunto(
                        params.leadUuid,
                        params.codigoEmpresa,
                        `Interesado en unidad ${params.unidad}`
                    );
                }
                return this.manejarBusquedaPorUnidad(params, collectionName);
            }

            // Normalizar dormitorios: Convertir strings "monoambiente" a 0
            let normalizedDorms: number | number[] | undefined = undefined;

            if (params.dormitorios !== undefined) {
                const processDorm = (val: string | number): number => {
                    if (typeof val === 'string') {
                        const v = val.toLowerCase();
                        if (v.includes('mono') || v.includes('estudio') || v.includes('loft')) return 0;
                        const parsed = parseInt(val);
                        return isNaN(parsed) ? -1 : parsed; // -1 for invalid
                    }
                    return val;
                };

                if (Array.isArray(params.dormitorios)) {
                    normalizedDorms = params.dormitorios.map(processDorm).filter(d => d !== -1);
                } else {
                    const val = processDorm(params.dormitorios);
                    if (val !== -1) normalizedDorms = val;
                }
            }

            // Actualizar params con valores normalizados para uso interno (Qdrant usa numeros)
            const paramsInternal = { ...params, dormitorios: normalizedDorms };


            // --- CASO ESPECIAL: MULTIPLES DORMITORIOS ---
            if (Array.isArray(paramsInternal.dormitorios) && paramsInternal.dormitorios.length > 0) {
                this.logger.log(`${logPrefix} Busqueda multi-dormitorios: ${paramsInternal.dormitorios.join(', ')}`);

                const promesas = paramsInternal.dormitorios.map(d => {
                    const singleParams = { ...paramsInternal, dormitorios: d }; // forzar individual
                    return this.ejecutarBusquedaQdrant(collectionName, singleParams, params.preferencia_piso);
                });

                const resultadosRaw = await Promise.all(promesas);

                // Agrupar resultados por dormitorio para reporte estructurado
                const resultadosPorDormitorio: { [key: number]: any[] } = {};
                const dormitoriosConResultados: number[] = [];
                const dormitoriosSinResultados: number[] = [];

                paramsInternal.dormitorios.forEach((d, idx) => {
                    const res = resultadosRaw[idx];
                    if (res.ok && res.items.length > 0) {
                        resultadosPorDormitorio[d] = res.items;
                        dormitoriosConResultados.push(d);
                    } else {
                        dormitoriosSinResultados.push(d);
                    }
                });

                // Si encontramos resultados (aunque sea de algunos dormitorios)
                if (dormitoriosConResultados.length > 0) {
                    let respuestaCompleta = `[ACCION_COMPLETADA] Aqui estan las opciones disponibles:\n\n`;

                    dormitoriosConResultados.sort((a, b) => a - b).forEach(dorms => {
                        const items = resultadosPorDormitorio[dorms].slice(0, 3); // Top 3 de cada tipo
                        const dormsLabel = dorms === 0 ? 'Monoambiente/Estudio' : `${dorms} dormitorio${dorms > 1 ? 's' : ''}`;
                        respuestaCompleta += `**Opciones tipo ${dormsLabel}:**\n`;

                        items.forEach((r, idx) => {
                            const m = r.document.metadata;
                            const pList = m.price_list ? parseFloat(m.price_list) : 0;
                            const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;
                            // Validacion temporal para no mostrar promos hasta nueva subida de data
                            const fechaLimite = new Date('2025-01-01');
                            const mostrarPromos = new Date() < fechaLimite;

                            let precioMostrar = '';
                            if (mostrarPromos && pPromo && pPromo < pList) {
                                precioMostrar = `S/${pList.toLocaleString('es-PE')} → **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
                            } else {
                                precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
                            }
                            const detalles = [
                                m.area_total ? `${m.area_total}m²` : '',
                                m.view ? `vista ${m.view}` : '',
                                m.floor ? `piso ${m.floor}` : ''
                            ].filter(Boolean).join(', ');

                            respuestaCompleta += `${idx + 1}. Unidad ${m.unit_number} - ${detalles} - ${precioMostrar}\n`;
                        });
                        respuestaCompleta += '\n';
                    });

                    if (dormitoriosSinResultados.length > 0) {
                        const missingLabels = dormitoriosSinResultados.map(d => d === 0 ? 'Monoambiente' : `${d} dorms`);
                        respuestaCompleta += `Por el momento **no tengo disponibles**: ${missingLabels.join(' ni ')}.\n\n`;
                    }

                    respuestaCompleta += `¿Te interesa alguna de estas opciones? Puedo enviarte planos y mas detalles.`;
                    return respuestaCompleta;
                }

                this.logger.warn(`${logPrefix} No hubo coincidencias en ninguno de los dormitorios solicitados: ${paramsInternal.dormitorios.join(', ')}`);
                const allLabels = paramsInternal.dormitorios.map(d => d === 0 ? 'Monoambiente' : `${d} dorms`);
                return `[ACCION_COMPLETADA] Lo siento, no encontre departamentos disponibles de ${allLabels.join(' ni ')} en este momento. ¿Te gustaria ver otras opciones?`;
            }

            let dormsNumber = typeof paramsInternal.dormitorios === 'number' ? paramsInternal.dormitorios :
                (Array.isArray(paramsInternal.dormitorios) && paramsInternal.dormitorios.length > 0 ? paramsInternal.dormitorios[0] : undefined);

            const simpleParams = { ...params, dormitorios: dormsNumber };


            // INTENTO 1: Busqueda Exacta
            this.logger.log(`${logPrefix} Intento 1: Filtros exactos`);
            let resultado = await this.ejecutarBusquedaQdrant(collectionName, simpleParams, params.preferencia_piso);

            this.logger.log(`${logPrefix} Intento 1 - Resultados: ${resultado.items.length}`);

            if (resultado.ok && resultado.items.length > 0) {
                return this.formatearRespuestaBusqueda(resultado.items, "Encontre estas opciones exactas para ti:");
            }

            // INTENTO 2: Relajar filtros secundarios (Vista y Tipologia) - NUNCA relajar tipo_unidad
            this.logger.log(`${logPrefix} Intento 2: Relajando Vista y Tipologia`);
            const paramsRelaxed1 = { ...simpleParams };
            delete paramsRelaxed1.vista;
            delete paramsRelaxed1.tipologia;
            // Si piden area_min, relajamos un 10%
            if (paramsRelaxed1.area_min) paramsRelaxed1.area_min = paramsRelaxed1.area_min * 0.9;

            resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsRelaxed1, params.preferencia_piso);

            if (resultado.ok && resultado.items.length > 0) {
                return this.formatearRespuestaBusqueda(resultado.items,
                    "No encontre opciones exactas con esa vista/tipo especificos, pero estas alternativas cumplen con dormitorios y presupuesto:");
            }

            // INTENTO 3: Relajar Presupuesto (Smart Range +/- 20%)
            this.logger.log(`${logPrefix} Intento 3: Relajando Presupuesto`);
            const paramsRelaxed2 = { ...paramsRelaxed1 };
            if (paramsRelaxed2.precio_max) paramsRelaxed2.precio_max = paramsRelaxed2.precio_max * 1.2; // +20%
            if (paramsRelaxed2.precio_min) paramsRelaxed2.precio_min = paramsRelaxed2.precio_min * 0.8; // -20%

            resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsRelaxed2, params.preferencia_piso);

            if (resultado.ok && resultado.items.length > 0) {
                return this.formatearRespuestaBusqueda(resultado.items,
                    "No encontre en el rango exacto de precio, pero estas opciones estan muy cerca:");
            }

            // INTENTO 3.5: Si pidieron tipologia que no existe, listar las disponibles
            if (simpleParams.tipologia) {
                this.logger.log(`${logPrefix} Intento 3.5: Listar tipologias disponibles`);
                const paramsSinTipologia = { ...simpleParams };
                delete paramsSinTipologia.tipologia;
                delete paramsSinTipologia.vista;
                delete paramsSinTipologia.area_min;

                resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsSinTipologia, params.preferencia_piso);

                if (resultado.ok && resultado.items.length > 0) {
                    // Extraer tipologias unicas disponibles
                    const tipologiasDisponibles = [...new Set(
                        resultado.items.map(i => i.document.metadata.typology).filter(Boolean)
                    )];

                    return this.formatearRespuestaBusqueda(resultado.items,
                        `No encontre exactamente "${simpleParams.tipologia}", pero aqui estan las opciones disponibles (tipologias: ${tipologiasDisponibles.join(', ')}):`);
                }
            }

            // INTENTO 4: Fallback Final - Solo Dormitorios (Lo mas importante)
            if (dormsNumber !== undefined) {
                this.logger.log(`${logPrefix} Intento 4: Solo Dormitorios`);
                const paramsFinal: any = { dormitorios: dormsNumber };
                if (params.tipo_unidad) paramsFinal.tipo_unidad = params.tipo_unidad;
                resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsFinal, params.preferencia_piso);

                if (resultado.ok && resultado.items.length > 0) {
                    const label = dormsNumber === 0 ? "tipo Monoambiente" : `de ${dormsNumber} dormitorios`;
                    return this.formatearRespuestaBusqueda(resultado.items,
                        `No tengo coincidencias exactas con todos los filtros, pero aqui estan departamentos ${label}:`);
                }
            }

            // INTENTO 5: Ultra-fallback - Listar todo sin filtros especificos (solo semantico)
            this.logger.log(`${logPrefix} Intento 5: Busqueda semantica sin filtros estrictos`);
            const ultraFallbackFilters: any = {};
            if (params.tipo_unidad) {
                let tipo = params.tipo_unidad.toString().trim();
                // Normalizacion para Dúplex
                if (tipo.toLowerCase() === 'duplex') {
                    tipo = 'Dúplex';
                }
                ultraFallbackFilters.tipoUnidad = tipo;
            }
            const allResults = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                'departamento disponible',
                ultraFallbackFilters,
                { limit: 10, threshold: 0.3, fallbackStrategy: 'none' }
            );

            if (allResults.length > 0) {
                const tipologiasDisponibles = [...new Set(
                    allResults.map(i => i.document.metadata.typology).filter(Boolean)
                )].sort();

                const lista = allResults.slice(0, 6).map((r, idx) => {
                    const m = r.document.metadata;
                    const pList = m.price_list ? parseFloat(m.price_list) : 0;
                    const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;
                    const fechaLimite = new Date('2025-01-01');
                    const mostrarPromos = new Date() < fechaLimite;

                    let precioMostrar = '';
                    if (mostrarPromos && pPromo && pPromo < pList) {
                        precioMostrar = `S/${pList.toLocaleString('es-PE')} -> **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
                    } else {
                        precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
                    }
                    const detalles = [
                        m.bedrooms ? `${m.bedrooms} dorm` : '',
                        m.area_total ? `${m.area_total}m2` : '',
                        m.view ? `Vista ${m.view}` : '',
                        m.typology ? `${m.typology}` : ''
                    ].filter(Boolean).join(', ');
                    return `${idx + 1}. Unidad ${m.unit_number} - ${detalles} - ${precioMostrar}`;
                }).join('\n');

                return `[ACCION_COMPLETADA] No encontré departamentos de ${dormsNumber} dormitorios tipo ${params.tipo_unidad || ''}, pero aquí tienes las opciones disponibles (tipologias: ${tipologiasDisponibles.join(', ')}):\n\n${lista}\n\n<<INSTRUCCION_IA: Pregunta por una tipologia especifica o cuantos dormitorios busca.>>`;
            }

            return "[ACCION_COMPLETADA] Lo siento, no encontre nada disponible ni siquiera relajando la busqueda. <<INSTRUCCION_IA: Pregunta si quiere ver departamentos de otra cantidad de dormitorios.>>";

        } catch (error) {
            this.logger.error(`Error en buscarDepartamentoUniversal: ${error.message}`, error.stack);
            return "Ocurrio un error tecnico al buscar. Por favor intenta de nuevo.";
        }
    }

    // --- MÉTODOS PRIVADOS DE AYUDA ---

    private async manejarBusquedaPorUnidad(params: any, collectionName: string) {
        const queryText = `unidad ${params.unidad}`;
        const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
            collectionName,
            queryText,
            {},
            { limit: 20, threshold: 0.3 }
        );

        const unidadExacta = resultados.find(r =>
            r.document.metadata.unit_number?.toString() === params.unidad?.toString()
        );

        if (unidadExacta) {
            const m = unidadExacta.document.metadata;
            await this.enviarPlanoSiCorresponde(m, params);
            return this.formatearDetalleUnidad(m);
        }

        return `[ACCION_COMPLETADA] No encontré la unidad ${params.unidad}. Revisa si el número es correcto.`;
    }

    private async ejecutarBusquedaQdrant(collectionName: string, params: any, preferenciaPiso?: 'bajos' | 'altos') {
        // Construir query text
        const queryParts = ['departamento disponible'];
        if (params.dormitorios) queryParts.push(`${params.dormitorios} dormitorios`);
        if (params.vista) queryParts.push(`vista ${params.vista}`);
        const queryText = queryParts.join(' ');

        // Construir filtros
        const filters: any = {};
        if (params.dormitorios !== undefined) filters.dormitorios = params.dormitorios;
        if (params.piso !== undefined) {
            filters.pisoMin = params.piso;
            filters.pisoMax = params.piso;
        }
        if (params.precio_min !== undefined) filters.precioMin = params.precio_min;
        if (params.precio_max !== undefined) filters.precioMax = params.precio_max;
        if (params.vista) filters.vista = params.vista;
        if (params.tipo_unidad) {
            let tipo = params.tipo_unidad.toString().trim();
            // Normalizacion para Dúplex (Qdrant tiene "Dúplex" con tilde)
            if (tipo.toLowerCase() === 'duplex') {
                tipo = 'Dúplex';
            }
            filters.tipoUnidad = tipo;
        }

        if (params.tipologia) {
            let tipologiaNormalizada = params.tipologia.toString().trim();
            if (!tipologiaNormalizada.toLowerCase().startsWith('tipo')) {
                tipologiaNormalizada = `Tipo ${tipologiaNormalizada}`;
            } else {
                // Capitalizar correctamente: "tipo 5" → "Tipo 5" en caso cuando viee solo numero 
                tipologiaNormalizada = tipologiaNormalizada.replace(/^tipo/i, 'Tipo');
            }
            filters.tipologia = tipologiaNormalizada;
            this.logger.debug(`[Tipología normalizada] "${params.tipologia}" → "${tipologiaNormalizada}"`);
        }

        if (params.area_min !== undefined) filters.areaMin = params.area_min;

        // Aumentamos límite para poder reordenar en memoria por precio
        const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
            collectionName,
            queryText,
            filters,
            { limit: 20, threshold: 0.4 }
        );

        // LÓGICA DE ORDENAMIENTO INTELIGENTE
        // Prioridad 1: Si especificó preferencia de piso
        if (preferenciaPiso) {
            resultados.sort((a, b) => {
                const pisoA = a.document.metadata.floor || 0;
                const pisoB = b.document.metadata.floor || 0;

                if (preferenciaPiso === 'bajos') {
                    return pisoA - pisoB; // Menor a mayor (piso 1, 2, 3...)
                } else {
                    return pisoB - pisoA; // Mayor a menor (piso 17, 16, 15...)
                }
            });
            this.logger.log(`[BusquedaUniversal] Resultados ordenados por pisos ${preferenciaPiso}: ${preferenciaPiso === 'bajos' ? 'ascendente' : 'descendente'}`);
        }
        // Prioridad 2: Si el usuario especificó precio (max o min), ordenamos por cercanía a ese precio
        else if (params.precio_max || params.precio_min) {
            const precioObjetivo = params.precio_max || params.precio_min;

            resultados.sort((a, b) => {
                const getPrecio = (item: any) => {
                    const m = item.document.metadata;
                    // Usar precio promo si existe y es menor, sino precio lista
                    const pPromo = m.price_promo ? parseFloat(m.price_promo) : null;
                    const pList = m.price_list ? parseFloat(m.price_list) : 0;
                    return (pPromo && pPromo < pList) ? pPromo : pList;
                };

                const precioA = getPrecio(a);
                const precioB = getPrecio(b);

                const distA = Math.abs(precioA - precioObjetivo);
                const distB = Math.abs(precioB - precioObjetivo);

                return distA - distB; // Menor distancia primero
            });

            this.logger.log(`[BusquedaUniversal] Resultados reordenados por cercanía a precio: ${precioObjetivo}`);
        }

        // Devolvemos solo los top 6 después de ordenar
        return { ok: true, items: resultados.slice(0, 6) };
    }

    private formatearRespuestaBusqueda(items: any[], mensajeIntro: string) {
        const lista = items.map((r, idx) => {
            const m = r.document.metadata;

            const pList = m.price_list ? parseFloat(m.price_list) : 0;
            const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;

            // Validacion temporal: Ocultar promos si la fecha actual > 2025 (simulando espera de data nueva)
            const fechaLimite = new Date('2025-01-01');
            const mostrarPromos = new Date() < fechaLimite;

            let precioMostrar = '';
            if (mostrarPromos && pPromo && pPromo < pList) {
                // Mostrar ambos precios para que el cliente vea que SI existe el de lista
                precioMostrar = `S/${pList.toLocaleString('es-PE')} -> **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
            } else {
                precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
            }

            const area = m.area_total ? `${m.area_total}m2` : '';
            const piso = m.floor ? `Piso ${m.floor}` : '';
            const vista = m.view ? `Vista ${m.view}` : '';
            const dorms = m.bedrooms ? `${m.bedrooms} dorm` : '';

            // Construir linea resumen compacta
            // Ej: 1. Unidad 1704 - 2 dorm, 65m2, Vista Calle - S/450,000
            const detalles = [dorms, area, vista, piso].filter(Boolean).join(', ');
            return `${idx + 1}. Unidad ${m.unit_number} - ${detalles} - ${precioMostrar}`;
        }).join('\n');

        return `[ACCION_COMPLETADA] ${mensajeIntro}\n\n${lista}\n\n<<INSTRUCCION_IA: Recomienda una opcion y pregunta si quiere ver el plano o agendar visita.>>`;
    }

    private formatearDetalleUnidad(m: any) {
        // Formatear precio mostrando lista y promocion si existe
        const pList = m.price_list ? parseFloat(m.price_list) : 0;
        const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;

        const fechaLimite = new Date('2025-01-01');
        const mostrarPromos = new Date() < fechaLimite;

        let precioTexto = '';
        if (mostrarPromos && pPromo && pPromo < pList) {
            precioTexto = `Precio lista: S/${pList.toLocaleString('es-PE')} | Precio oferta: S/${pPromo.toLocaleString('es-PE')}`;
        } else {
            precioTexto = `S/${pList.toLocaleString('es-PE')}`;
        }

        // Construir detalle completo con TODOS los campos disponibles
        const detalles: string[] = [
            `[ACCION_COMPLETADA] **Unidad ${m.unit_number}**`,
            `- Proyecto: ${m.project_name || 'Residencial Los Lirios'}`,
            `- Tipo: ${m.unit_type || 'Departamento'} (${m.typology || 'Standard'})`,
            `- Piso: ${m.floor}`,
            `- Dormitorios: ${m.bedrooms}`,
            `- Area total: ${m.area_total}m2`,
            `- Vista: ${m.view}`,
            `- Precio: ${precioTexto}`,
            `- Disponibilidad: ${m.availability || 'Disponible'}`,
        ];

        if (m.bathrooms) detalles.push(`- Banos: ${m.bathrooms}`);
        if (m.parking) detalles.push(`- Estacionamiento: ${m.parking}`);
        if (m.storage) detalles.push(`- Deposito: ${m.storage}`);

        detalles.push('');
        detalles.push('<<INSTRUCCION_IA: Ya se envio el plano al cliente. Muestra TODOS los datos de arriba en tu respuesta y continua con el flujo de venta.>>');

        return detalles.join('\n');
    }

    private async enviarPlanoSiCorresponde(m: any, params: any) {
        if (!params.phoneNumber || !m.url_floor_plan) return;

        const imageUrl = this.convertGoogleDriveToDirectUrl(m.url_floor_plan);
        if (!imageUrl) return;

        try {
            await this.wapiService.sendImageByUrl(
                params.codigoEmpresa || 1,
                params.phoneNumber,
                imageUrl,
                `Plano Unidad ${m.unit_number}`
            );

            // Logear en inbox si es posible
            if (params.leadUuid) {
                await this.inboxService.guardarMensajeBot({
                    leadUuid: params.leadUuid,
                    codigoEmpresa: params.codigoEmpresa || 1,
                    contenido: `Plano Unidad ${m.unit_number}`,
                    tipoMultimedia: 'image',
                    urlMultimedia: imageUrl,
                    estadoMensaje: 'enviado'
                }).catch(e => this.logger.error(e));
            }
        } catch (e) {
            this.logger.error("Error enviando plano", e);
        }
    }

    async buscarInmueble(params: { dormitorios?: number, precio_max?: number }) {
        return this.mostrarDepartamentos({ dormitorios: params.dormitorios });
    }

    async enviarBrochure(params: {
        nombre_proyecto: string;
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            const path = require('path');
            const brochurePath = path.join(process.cwd(), 'storage', 'multimedia', 'brochure-los-lirios.pdf');

            if (!params.phoneNumber || !params.leadUuid) {
                return `Aqui esta el brochure del proyecto ${params.nombre_proyecto}`;
            }

            const codigoEmpresa = params.codigoEmpresa || 1;

            // Enviar el PDF por WhatsApp
            const response: any = await this.wapiService.sendDocument(
                codigoEmpresa,
                params.phoneNumber,
                brochurePath,
                `Brochure del proyecto ${params.nombre_proyecto}`
            );

            this.logger.log(`Brochure enviado a ${params.phoneNumber}`);

            let wamid = null;
            let estado = 'enviado';
            let errorDetails = null;

            if (response && response.error) {
                estado = 'fallido';
                errorDetails = response.details;
            } else {
                wamid = response?.messages?.[0]?.id || response?.id || null;
            }

            // Guardar el mensaje en la base de datos para el inbox
            // Usar ruta relativa web para que el frontend pueda renderizar
            const urlRelativa = '/storage/multimedia/brochure-los-lirios.pdf';
            await this.inboxService.guardarMensajeBot({
                leadUuid: params.leadUuid,
                codigoEmpresa: codigoEmpresa,
                contenido: `Brochure del proyecto ${params.nombre_proyecto}`,
                tipoMultimedia: 'document',
                urlMultimedia: urlRelativa,
                wamid: wamid,
                estadoMensaje: estado,
                errorWapi: errorDetails
            });

            return `[ACCION_COMPLETADA] Brochure del proyecto ${params.nombre_proyecto} enviado exitosamente al cliente. <<INSTRUCCION_IA: No ejecutes esta herramienta de nuevo. Continua con tu mensaje de seguimiento.>>`;

        } catch (error) {
            this.logger.error(`Error enviando brochure: ${error.message}`);
            return `Hubo un error al enviar el brochure. Por favor intenta de nuevo.`;
        }
    }

    async enviarMapa(params: {
        nombre_proyecto: string;
        unidad_id: string;
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            const collectionName = this.configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'checor-projects-v1';

            // Buscar la unidad en Qdrant
            const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                `unidad ${params.unidad_id}`,
                {},
                { limit: 20, threshold: 0.3 }
            );

            // Encontrar unidad exacta
            const unidadExacta = resultados.find(r =>
                r.document.metadata.unit_number?.toString() === params.unidad_id?.toString()
            );

            if (!unidadExacta) {
                return `No encontré información de la unidad ${params.unidad_id}`;
            }

            const metadata = unidadExacta.document.metadata;

            // Enviar imagen del plano si existe
            if (params.phoneNumber && metadata.url_floor_plan) {
                const imageUrl = this.convertGoogleDriveToDirectUrl(metadata.url_floor_plan);
                const codigoEmpresa = params.codigoEmpresa || 1;
                if (imageUrl) {
                    try {
                        const response: any = await this.wapiService.sendImageByUrl(
                            codigoEmpresa,
                            params.phoneNumber,
                            imageUrl,
                            `Plano de la unidad ${params.unidad_id}`
                        );
                        this.logger.log(`✅ Plano enviado para unidad ${params.unidad_id}`);

                        let estado = 'enviado';
                        let errorDetails = null;

                        if (response && response.error) {
                            estado = 'fallido';
                            errorDetails = response.details;
                        }

                        // Guardar mensaje en BD si tenemos leadUuid
                        if (params.leadUuid) {
                            try {
                                await this.inboxService.guardarMensajeBot({
                                    leadUuid: params.leadUuid,
                                    codigoEmpresa: codigoEmpresa,
                                    contenido: `Plano de la unidad ${params.unidad_id}`,
                                    tipoMultimedia: 'image',
                                    urlMultimedia: imageUrl,
                                    estadoMensaje: estado,
                                    errorWapi: errorDetails
                                });
                                this.logger.log(`💾 Mensaje con imagen guardado en BD - Unidad ${params.unidad_id}`);
                            } catch (dbError) {
                                this.logger.error(`Error guardando mensaje en BD: ${dbError.message}`);
                            }
                        }

                        return `[ACCION_COMPLETADA] Plano del departamento ${params.unidad_id} enviado exitosamente. <<INSTRUCCION_IA: No ejecutes esta herramienta de nuevo.>>`;
                    } catch (error) {
                        this.logger.error(`Error enviando plano: ${error.message}`);
                        return `[ACCION_COMPLETADA] Tuve un problema enviando el plano. Aqui esta el link: ${metadata.url_floor_plan}`;
                    }
                }
            }

            // Si no hay phoneNumber o url_floor_plan
            return metadata.url_floor_plan
                ? `Aquí está el link del plano: ${metadata.url_floor_plan}`
                : `No tengo el plano de la unidad ${params.unidad_id} disponible`;

        } catch (error) {
            this.logger.error(`Error en enviarMapa: ${error.message}`);
            return `Ocurrió un error al buscar el plano de la unidad ${params.unidad_id}`;
        }
    }

    /**
     * Envía la ubicación del proyecto en Google Maps
     */
    async enviarUbicacionGoogleMaps(params: { nombre_proyecto: string, unidad_id?: string }) {
        try {
            const collectionName = this.configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'checor-projects-v1';
            const buildFaqQuery = () => ([
                `¿Dónde se encuentra ubicado el proyecto ${params.nombre_proyecto}?`,
                `ubicación del proyecto ${params.nombre_proyecto}`,
                `dirección del proyecto ${params.nombre_proyecto}`,
            ]);

            // Buscar cualquier unidad del proyecto para obtener url_location
            const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                params.nombre_proyecto,
                {},
                { limit: 1, threshold: 0.3 }
            );

            if (resultados.length === 0) {
                return `No encontré información del proyecto ${params.nombre_proyecto}`;
            }

            const urlLocation = resultados[0].document.metadata.url_location;

            if (!urlLocation) {
                return this.buscarPreguntasFrecuentes({
                    queries_de_busqueda: buildFaqQuery(),
                    nombre_proyecto: params.nombre_proyecto
                });
            }

            return `[ACCION_COMPLETADA] Ubicacion del proyecto ${params.nombre_proyecto}: ${urlLocation}.`;

        } catch (error) {
            this.logger.error(`Error en enviarUbicacionGoogleMaps: ${error.message}`);
            return this.buscarPreguntasFrecuentes({
                queries_de_busqueda: [
                    `¿Dónde se encuentra ubicado el proyecto ${params.nombre_proyecto}?`,
                    `ubicación del proyecto ${params.nombre_proyecto}`,
                    `dirección del proyecto ${params.nombre_proyecto}`,
                ],
                nombre_proyecto: params.nombre_proyecto
            });
        }
    }

    /**
     * Envía los videos promocionales del proyecto por WhatsApp.
     * Envía automáticamente AMBOS videos disponibles en storage/videos.
     */
    async enviarVideosProyecto(params: {
        nombre_proyecto: string;
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            const path = require('path');
            const fs = require('fs');

            // Rutas de los videos del proyecto
            const videosDir = path.join(process.cwd(), 'storage', 'videos');
            const videosDisponibles = [
                { archivo: 'LIRIOS_TIPOLOGIAS_6_final.mp4', descripcion: 'Video de tipologías del proyecto' },
                { archivo: 'lirios_tipo_3_final.mp4', descripcion: 'Video promocional del proyecto' }
            ];

            // Validar parámetros mínimos para enviar
            if (!params.phoneNumber || !params.leadUuid) {
                return `[ACCION_COMPLETADA] Los videos del proyecto ${params.nombre_proyecto} están disponibles. Proporciona tu número para enviártelos.`;
            }

            const codigoEmpresa = params.codigoEmpresa || 1;
            const videosEnviados: string[] = [];
            const erroresEnvio: string[] = [];

            // Enviar cada video secuencialmente
            for (const video of videosDisponibles) {
                const rutaVideo = path.join(videosDir, video.archivo);

                // Verificar que el archivo existe
                if (!fs.existsSync(rutaVideo)) {
                    this.logger.warn(`[EnviarVideos] Archivo no encontrado: ${rutaVideo}`);
                    erroresEnvio.push(video.archivo);
                    continue;
                }

                try {
                    const response: any = await this.wapiService.sendVideo(
                        codigoEmpresa,
                        params.phoneNumber,
                        rutaVideo,
                        video.descripcion
                    );

                    let wamid = null;
                    let estado = 'enviado';
                    let errorDetails = null;

                    if (response && response.error) {
                        estado = 'fallido';
                        errorDetails = response.details;
                        erroresEnvio.push(video.archivo);
                    } else {
                        wamid = response?.messages?.[0]?.id || response?.id || null;
                        videosEnviados.push(video.archivo);
                    }

                    // Registrar en inbox con ruta relativa web para que el frontend pueda renderizar
                    const urlRelativaVideo = `/storage/videos/${video.archivo}`;
                    await this.inboxService.guardarMensajeBot({
                        leadUuid: params.leadUuid,
                        codigoEmpresa: codigoEmpresa,
                        contenido: video.descripcion,
                        tipoMultimedia: 'video',
                        urlMultimedia: urlRelativaVideo,
                        wamid: wamid,
                        estadoMensaje: estado,
                        errorWapi: errorDetails
                    });

                    this.logger.log(`[EnviarVideos] Video enviado: ${video.archivo}`);

                } catch (videoError) {
                    this.logger.error(`[EnviarVideos] Error enviando ${video.archivo}: ${videoError.message}`);
                    erroresEnvio.push(video.archivo);
                }
            }

            // Generar respuesta según resultados
            if (videosEnviados.length === videosDisponibles.length) {
                return `[ACCION_COMPLETADA] Videos del proyecto ${params.nombre_proyecto} enviados exitosamente. <<INSTRUCCION_IA: No ejecutes esta herramienta de nuevo. Pregunta que le parecieron los videos.>>`;
            } else if (videosEnviados.length > 0) {
                return `[ACCION_COMPLETADA] Se enviaron ${videosEnviados.length} de ${videosDisponibles.length} videos. Algunos tuvieron problemas, pero ya tienes material para revisar.`;
            } else {
                return `Hubo un problema al enviar los videos. Por favor intenta de nuevo más tarde.`;
            }

        } catch (error) {
            this.logger.error(`[EnviarVideos] Error general: ${error.message}`);
            return `Hubo un error al enviar los videos del proyecto. Por favor intenta de nuevo.`;
        }
    }

    /**
     * Descarta un cliente que se molestó o pidió no ser contactado
     * Clasifica como "descartado" y cierra la sesión para evitar futuras plantillas
     */
    async descartarCliente(params: {
        motivo: string;
        leadUuid: string;
        codigoEmpresa: number;
    }) {
        try {
            this.logger.log(`Descartando cliente: ${params.leadUuid} - Motivo: ${params.motivo}`);

            // 1. Buscar sesión activa
            const sesion = await this.sesionRepo.findOne({
                where: {
                    leadUuid: params.leadUuid,
                    codigoEmpresa: params.codigoEmpresa
                }
            });

            if (!sesion) {
                this.logger.warn(`No se encontró sesión para lead: ${params.leadUuid}`);
                return {
                    success: false,
                    mensaje: "No se pudo procesar la solicitud."
                };
            }

            // 2. Insertar clasificación como DESCARTADO
            const clasificacion = this.clasificacionRepo.create({
                idSesion: sesion.id,
                clasificacion: 'descartado',
                razon: `Cliente descartado: ${params.motivo}`,
            });
            await this.clasificacionRepo.save(clasificacion);

            // 3. Actualizar estado de sesión a 2 (cerrado)
            sesion.idEstado = 2;
            sesion.proximoMensajeMinutos = 0; // Detener plantillas
            await this.sesionRepo.save(sesion);

            // 4. Registrar en resumen
            await this.resumenService.agregarPunto(
                params.leadUuid,
                params.codigoEmpresa,
                `Cliente descartado: ${params.motivo}`
            );

            this.logger.log(`Cliente descartado exitosamente - Lead: ${params.leadUuid}`);

            return {
                success: true,
                mensaje: "[ACCION_COMPLETADA] Entendido. Lamento las molestias. No volverás a recibir mensajes nuestros. Que tengas un excelente día."
            };

        } catch (error) {
            this.logger.error(`Error descartando cliente: ${error.message}`);
            return {
                success: false,
                mensaje: "Disculpa las molestias. Entendido, no te contactaremos más."
            };
        }
    }

    /**
     * Corrige errores ortográficos y normaliza ocupaciones usando LLM
     */
    private async corregirOcupacion(ocupacion: string): Promise<string> {
        if (!ocupacion) return ocupacion;

        try {
            const OcupacionSchema = z.object({
                ocupacion_normalizada: z.string().describe('La ocupación corregida y con mayúsculas capitalizadas, ej: "Ingeniero De Sistemas"')
            });

            const extractor = this.llm.withStructuredOutput(OcupacionSchema);
            const prompt = `Corrige la ortografía y normaliza esta ocupación profesional: "${ocupacion}". Si no es una ocupación clara, devuélvela como está pero capitalizada. Ejemplo: "ing sistemas" -> "Ingeniero de Sistemas".`;

            const result = await extractor.invoke(prompt);
            return result.ocupacion_normalizada;

        } catch (error) {
            this.logger.warn(`Error corrigiendo ocupación con LLM: ${error.message}`);
            // Fallback simple: Capitalizar
            return ocupacion.trim().replace(/\b\w/g, c => c.toUpperCase());
        }
    }

    /**
     * Formatea un monto numérico a formato legible con separadores
     * Ej: 5000 -> "S/ 5,000" | 713600 -> "S/ 713,600"
     */
    private formatearMonto(valor: string | number | undefined): string {
        if (!valor) return 'N/A';
        const num = typeof valor === 'string' ? parseFloat(valor.replace(/[^\d.]/g, '')) : valor;
        if (isNaN(num)) return String(valor);
        return `S/ ${num.toLocaleString('es-PE')}`;
    }
}
