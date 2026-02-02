import { Injectable, Logger } from '@nestjs/common';
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
import { Repository } from 'typeorm';
import { SesionConversacion } from '../entities/sesion-conversacion.entity';
import { HistorialClasificacionLead } from '../../clasificacion-leads/entities/historial-clasificacion-lead.entity';

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
        @InjectRepository(HistorialClasificacionLead) private clasificacionRepo: Repository<HistorialClasificacionLead>
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
                return "[ACCION_COMPLETADA] No encontre propiedades con esas caracteristicas especificas. Pregunta si quiere ver otras opciones similares.";
            }

            // Formatear respuesta para el LLM final
            const contextText = results.map((d: any, i: number) => {
                const m = d.metadata;
                return `OPCION ${i + 1}:
- Proyecto: ${m.project_name}
- Unidad: ${m.unit_number} (${m.type || 'Depa'})
- Precio: ${m.currency} ${m.price_promo} (Antes: ${m.price_list})
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

    async agendarCita(params: any, codigoEmpresa: number, leadUuid: string) {
        this.logger.log(`Intentando agendar cita: ${JSON.stringify(params)}`);

        const { fecha_cita, hora_cita, nombre_proyecto, tipo_cita, unidad_interes, dormitorios, precio_referencial } = params;

        // 0. Validar si ya tiene una cita ACTIVA
        const ultimaCita = await this.citasService.obtenerUltimaCitaPorLead(leadUuid, codigoEmpresa);

        if (ultimaCita) {
            // Verificar si la cita es futura y está pendiente o confirmada
            const fechaCitaExistente = new Date(`${ultimaCita.fechaCita}T${ultimaCita.horaCita}`);
            const ahora = new Date();

            // Si la fecha de la cita existente es MAYOR a la fecha actual (futuro)
            // Y su estado NO es cancelada ni realizada
            const citaEsFutura = fechaCitaExistente > ahora;
            const citaEsActiva = ultimaCita.estadoCita === 'pendiente' || ultimaCita.estadoCita === 'confirmada';

            if (citaEsActiva && citaEsFutura) {
                return {
                    success: false,
                    mensaje: `Ya tienes una cita programada para el ${ultimaCita.fechaCita} a las ${ultimaCita.horaCita}. Si deseas reagendarla, primero debemos cancelar la anterior o coordinar el cambio.`
                };
            }
        }

        // 1. Validar disponibilidad (básico)
        const ocupado = await this.citasService.existeCitaEnHorario(fecha_cita, hora_cita, codigoEmpresa);

        if (ocupado) {
            return {
                success: false,
                mensaje: `Lo siento, el horario de las ${hora_cita} para el día ${fecha_cita} ya está ocupado. ¿Podrías elegir otro horario?`
            };
        }

        // Construir observación detallada
        let observacion = `Proyecto interés: ${nombre_proyecto}`;
        if (unidad_interes) observacion += ` | Unidad: ${unidad_interes}`;
        if (dormitorios) observacion += ` | Dorms: ${dormitorios}`;
        if (precio_referencial) observacion += ` | Precio: S/${precio_referencial}`;

        // 2. Crear Cita
        await this.citasService.crearCita({
            codigoEmpresa,
            leadUuid: leadUuid, // UUID del prospecto
            fechaCita: fecha_cita,
            horaCita: hora_cita,
            tipoCita: tipo_cita || 'presencial',
            observacion: observacion,
            estadoCita: 'pendiente'
        });

        // 3. Actualizar Estado Sesion y Clasificacion
        try {
            const sesion = await this.sesionRepo.findOne({ where: { leadUuid, codigoEmpresa } });
            if (sesion) {
                // Actualizar a estado 2 (convertido/cita)
                sesion.idEstado = 2; // TODO: Usar Enum si existe
                await this.sesionRepo.save(sesion);

                // Insertar Historial Clasificacion
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
            // No bloqueamos el retorno de exito de la cita
        }

        return {
            success: true,
            mensaje: `[ACCION_COMPLETADA] Cita agendada exitosamente para el proyecto ${nombre_proyecto} el día ${fecha_cita} a las ${hora_cita}. NO repitas esta herramienta.`
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
                return "[ACCION_COMPLETADA] No encontre informacion sobre eso en mis registros. Continua la conversacion.";
            }

            return `[ACCION_COMPLETADA] ${resultado}`;

        } catch (error) {
            this.logger.error(`Error en buscarPreguntasFrecuentes: ${error.message}`);
            return "Hubo un error consultando las preguntas frecuentes.";
        }
    }

    async validarDni(params: { dni: string }) {
        const { dni } = params;

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

        return { success: true, mensaje: "[ACCION_COMPLETADA] DNI validado correctamente. Continua con el siguiente paso." };
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
                const precioPromo = parseFloat(m.price_promo?.replace(/[^0-9.]/g, '') || m.price_list?.replace(/[^0-9.]/g, '') || '0');
                const cuotaAprox = Math.round(precioPromo / 200); // Aproximación simple

                return {
                    unidad: m.unit_number,
                    dormitorios: m.bedrooms,
                    area: m.area_total,
                    piso: m.floor,
                    precio_lista: m.price_list,
                    precio_promo: m.price_promo,
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
                return "[ACCION_COMPLETADA] No encontre departamentos disponibles con esas caracteristicas. Pregunta si quiere ver otras opciones.";
            }
            // Mostrar lista de resultados
            const lista = resultados.map((r, idx) => {
                const m = r.document.metadata;

                // Formatear precios
                const pList = m.price_list ? parseFloat(m.price_list) : 0;
                const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;

                let precioMostrar = '';
                if (pPromo && pPromo < pList) {
                    precioMostrar = `S/${pList.toLocaleString('es-PE')} -> **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
                } else {
                    precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
                }

                const dormitoriosText = m.bedrooms === 0 ? 'Monoambiente' : `${m.bedrooms} dormitorio${m.bedrooms > 1 ? 's' : ''}`;

                return `${idx + 1}. Unidad ${m.unit_number} - ${dormitoriosText}, ${m.area_total}m² - Precio: ${precioMostrar}`;
            }).join('\n');

            const respuesta = `[ACCION_COMPLETADA] Hay ${resultados.length} departamento${resultados.length > 1 ? 's' : ''} disponible${resultados.length > 1 ? 's' : ''}:\n\n${lista}\n\nPregunta si quiere agendar visita.`;

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

            // Construir resumen formateado
            const resumen = `📝 RESUMEN DE TU COTIZACIÓN\n\n` +
                `DATOS DEL CLIENTE:\n` +
                `. Nombre: ${params.nombre_cliente || 'N/A'}\n` +
                `. DNI: ${params.dni || 'N/A'}\n` +
                `. Ocupación: ${params.ocupacion || 'N/A'}\n` +
                `. Ingresos: ${params.ingresos || 'N/A'}\n\n` +
                `DETALLES DEL DEPARTAMENTO:\n` +
                `. Unidad: ${params.unidad || 'N/A'}\n` +
                `. Dormitorios: ${params.dormitorios || 'N/A'}\n` +
                `. Área: ${params.area || 'N/A'}\n` +
                `. Piso: ${params.piso || 'N/A'}\n` +
                `. Precio: ${params.precio || 'N/A'}\n\n`;

            // Enviar mensaje por WhatsApp si hay teléfono
            // Enviar mensaje por WhatsApp si hay teléfono
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

            return `[ACCION_COMPLETADA] Proforma generada y ENVIADA al cliente por WhatsApp. Dile que ya se la enviaste y pregunta si quiere ver el recorrido virtual.`;

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
        dormitorios?: number;
        piso?: number;
        precio_max?: number;
        precio_min?: number;
        vista?: string;
        tipologia?: string;
        area_min?: number;
        phoneNumber?: string;
        codigoEmpresa?: number;
        leadUuid?: string;
    }) {
        try {
            const collectionName = this.configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'checor-projects-v1';
            const logPrefix = `[BusquedaUniversal]`;

            this.logger.log(`${logPrefix} Params: ${JSON.stringify(params)}`);

            // --- CASO 1: BÚSQUEDA POR UNIDAD ESPECÍFICA (Prioridad Máxima) ---
            if (params.unidad) {
                return this.manejarBusquedaPorUnidad(params, collectionName);
            }


            // INTENTO 1: Búsqueda Exacta
            this.logger.log(`${logPrefix} Intento 1: Filtros exactos`);
            let resultado = await this.ejecutarBusquedaQdrant(collectionName, params);

            this.logger.log(`${logPrefix} Intento 1 - Resultados: ${resultado.items.length}`);
            if (resultado.items.length > 0) {
                this.logger.debug(`${logPrefix} Primeros resultados: ${JSON.stringify(resultado.items.slice(0, 2).map(i => ({
                    unit: i.document.metadata.unit_number,
                    typology: i.document.metadata.typology,
                    availability: i.document.metadata.availability
                })))}`);
            }

            if (resultado.ok && resultado.items.length > 0) {
                return this.formatearRespuestaBusqueda(resultado.items, "Encontré estas opciones exactas para ti:");
            }

            // INTENTO 2: Relajar filtros secundarios (Vista y Tipología)
            this.logger.log(`${logPrefix} Intento 2: Relajando Vista y Tipologia`);
            const paramsRelaxed1 = { ...params };
            delete paramsRelaxed1.vista;
            delete paramsRelaxed1.tipologia;
            // Si piden area_min, relajamos un 10%
            if (paramsRelaxed1.area_min) paramsRelaxed1.area_min = paramsRelaxed1.area_min * 0.9;

            resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsRelaxed1);

            if (resultado.ok && resultado.items.length > 0) {
                return this.formatearRespuestaBusqueda(resultado.items,
                    "No encontré opciones exactas con esa vista/tipo específicados, pero garanticé los dormitorios y presupuesto. Mira estas alternativas:");
            }

            // INTENTO 3: Relajar Presupuesto (Smart Range +/- 20%)
            this.logger.log(`${logPrefix} Intento 3: Relajando Presupuesto`);
            const paramsRelaxed2 = { ...paramsRelaxed1 };
            if (paramsRelaxed2.precio_max) paramsRelaxed2.precio_max = paramsRelaxed2.precio_max * 1.2; // +20%
            if (paramsRelaxed2.precio_min) paramsRelaxed2.precio_min = paramsRelaxed2.precio_min * 0.8; // -20%

            resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsRelaxed2);

            if (resultado.ok && resultado.items.length > 0) {
                return this.formatearRespuestaBusqueda(resultado.items,
                    "No encontré en el rango exacto de precio, pero estas opciones están muy cerca y valen la pena revisar:");
            }

            // INTENTO 3.5: Si pidieron tipología que no existe, listar las disponibles
            if (params.tipologia) {
                this.logger.log(`${logPrefix} Intento 3.5: Listar tipologías disponibles`);
                const paramsSinTipologia = { ...params };
                delete paramsSinTipologia.tipologia;
                delete paramsSinTipologia.vista;
                delete paramsSinTipologia.area_min;

                resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsSinTipologia);

                if (resultado.ok && resultado.items.length > 0) {
                    // Extraer tipologías únicas disponibles
                    const tipologiasDisponibles = [...new Set(
                        resultado.items.map(i => i.document.metadata.typology).filter(Boolean)
                    )];

                    return this.formatearRespuestaBusqueda(resultado.items,
                        `No encontré exactamente "${params.tipologia}", pero aquí están las opciones disponibles (tipologías: ${tipologiasDisponibles.join(', ')}):`);
                }
            }

            // INTENTO 4: Fallback Final - Solo Dormitorios (Lo más importante)
            if (params.dormitorios) {
                this.logger.log(`${logPrefix} Intento 4: Solo Dormitorios`);
                const paramsFinal = { dormitorios: params.dormitorios };
                resultado = await this.ejecutarBusquedaQdrant(collectionName, paramsFinal);

                if (resultado.ok && resultado.items.length > 0) {
                    return this.formatearRespuestaBusqueda(resultado.items,
                        `Actualmente no tengo coincidencias exactas con todos los filtros, pero aquí están TODOS los departamentos disponibles de ${params.dormitorios} dormitorios:`);
                }
            }

            // INTENTO 5: Ultra-fallback - Listar todo sin filtros específicos (solo semántico)
            this.logger.log(`${logPrefix} Intento 5: Búsqueda semántica sin filtros estrictos`);
            const allResults = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                'departamento disponible',
                {}, // SIN filtros
                { limit: 10, threshold: 0.3, fallbackStrategy: 'none' }
            );

            if (allResults.length > 0) {
                // Extraer tipologías únicas para informar al usuario
                const tipologiasDisponibles = [...new Set(
                    allResults.map(i => i.document.metadata.typology).filter(Boolean)
                )].sort();

                // Formatear manualmente para este caso especial
                const lista = allResults.slice(0, 6).map((r, idx) => {
                    const m = r.document.metadata;
                    const pList = m.price_list ? parseFloat(m.price_list) : 0;
                    const pPromo = m.price_promo ? parseFloat(m.price_promo) : 0;
                    let precioMostrar = '';
                    if (pPromo && pPromo < pList) {
                        precioMostrar = `S/${pList.toLocaleString('es-PE')} -> **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
                    } else {
                        precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
                    }
                    const detalles = [
                        m.bedrooms ? `${m.bedrooms} dorm` : '',
                        m.area_total ? `${m.area_total}m²` : '',
                        m.view ? `Vista ${m.view}` : '',
                        m.typology ? `${m.typology}` : ''
                    ].filter(Boolean).join(', ');
                    return `${idx + 1}. Unidad ${m.unit_number} - ${detalles} - ${precioMostrar}`;
                }).join('\n');

                return `[ACCION_COMPLETADA] Aquí tienes las opciones de departamentos disponibles (tipologías: ${tipologiasDisponibles.join(', ')}):\n\n${lista}\n\nPregúntame por una tipología específica o cuántos dormitorios buscas.`;
            }

            return "[ACCION_COMPLETADA] Lo siento, realmente no encontré nada disponible ni siquiera relajando la búsqueda. Pregúntale si quiere ver departamentos de otra cantidad de dormitorios.";

        } catch (error) {
            this.logger.error(`Error en buscarDepartamentoUniversal: ${error.message}`, error.stack);
            return "Ocurrió un error técnico al buscar. Por favor intenta de nuevo.";
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

    private async ejecutarBusquedaQdrant(collectionName: string, params: any) {
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

        // LÓGICA DE ORDENAMIENTO POR PRECIO
        // Si el usuario especificó precio (max o min), ordenamos por cercanía a ese precio
        if (params.precio_max || params.precio_min) {
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

            let precioMostrar = '';
            if (pPromo && pPromo < pList) {
                // Mostrar ambos precios para que el cliente vea que SI existe el de lista
                precioMostrar = `S/${pList.toLocaleString('es-PE')} -> **S/${pPromo.toLocaleString('es-PE')}** (Oferta)`;
            } else {
                precioMostrar = `**S/${pList.toLocaleString('es-PE')}**`;
            }

            const area = m.area_total ? `${m.area_total}m²` : '';
            const piso = m.floor ? `Piso ${m.floor}` : '';
            const vista = m.view ? `Vista ${m.view}` : '';
            const dorms = m.bedrooms ? `${m.bedrooms} dorm` : '';

            // Construir línea resumen compacta
            // Ej: 1. Unidad 1704 - 2 dorm, 65m2, Vista Calle - S/450,000
            const detalles = [dorms, area, vista, piso].filter(Boolean).join(', ');
            return `${idx + 1}. Unidad ${m.unit_number} - ${detalles} - ${precioMostrar}`;
        }).join('\n');

        return `[ACCION_COMPLETADA] ${mensajeIntro}\n\n${lista}\n\nRecomienda una opcion y pregunta si quiere ver el plano o agendar visita.`;
    }

    private formatearDetalleUnidad(m: any) {
        const precio = m.price_promo && parseFloat(m.price_promo) < parseFloat(m.price_list)
            ? `S/ ${parseFloat(m.price_promo).toLocaleString('es-PE')}`
            : `S/ ${parseFloat(m.price_list).toLocaleString('es-PE')}`;

        return `[ACCION_COMPLETADA] **Unidad ${m.unit_number}**\n` +
            `- Tipo: ${m.unit_type} (${m.typology || 'Standard'})\n` +
            `- Piso: ${m.floor}\n` +
            `- Dormitorios: ${m.bedrooms}\n` +
            `- Área: ${m.area_total}m²\n` +
            `- Vista: ${m.view}\n` +
            `- Precio: ${precio}\n` +
            `- Disponibilidad: ${m.availability}\n\n` +
            `Para separar esta unidad, necesito tu DNI y nombre completo.`;
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
            await this.inboxService.guardarMensajeBot({
                leadUuid: params.leadUuid,
                codigoEmpresa: codigoEmpresa,
                contenido: `Brochure del proyecto ${params.nombre_proyecto}`,
                tipoMultimedia: 'document',
                urlMultimedia: brochurePath,
                wamid: wamid,
                estadoMensaje: estado,
                errorWapi: errorDetails
            });

            return `[ACCION_COMPLETADA] Brochure del proyecto ${params.nombre_proyecto} enviado exitosamente al cliente. NO vuelvas a ejecutar esta herramienta. Continua con tu mensaje de seguimiento.`;

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

                        return `[ACCION_COMPLETADA] Plano del departamento ${params.unidad_id} enviado exitosamente. NO repitas esta herramienta.`;
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
                return `[ACCION_COMPLETADA] El proyecto Los Lirios esta ubicado en Av. Petit Thouars 1737, Lince, Lima.`;
            }

            return `[ACCION_COMPLETADA] Ubicacion del proyecto Los Lirios: ${urlLocation} - Estamos en Av. Petit Thouars 1737, Lince, Lima.`;

        } catch (error) {
            this.logger.error(`Error en enviarUbicacionGoogleMaps: ${error.message}`);
            return `El proyecto está ubicado en Av. Petit Thouars 1737, Lince.`;
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

                    // Registrar en inbox
                    await this.inboxService.guardarMensajeBot({
                        leadUuid: params.leadUuid,
                        codigoEmpresa: codigoEmpresa,
                        contenido: video.descripcion,
                        tipoMultimedia: 'video',
                        urlMultimedia: rutaVideo,
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
                return `[ACCION_COMPLETADA] Videos del proyecto ${params.nombre_proyecto} enviados exitosamente. NO vuelvas a ejecutar esta herramienta. Pregunta qué le parecieron los videos.`;
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
}
