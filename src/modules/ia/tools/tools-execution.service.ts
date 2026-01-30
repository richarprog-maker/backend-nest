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
        private inboxService: InboxService
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

            const lista = resultados.map((r, idx) => {
                const m = r.document.metadata;
                const precioMostrar = m.price_promo && parseFloat(m.price_promo) < parseFloat(m.price_list)
                    ? `S/ ${parseFloat(m.price_promo).toLocaleString('es-PE')}`
                    : `S/ ${parseFloat(m.price_list).toLocaleString('es-PE')}`;

                const dormitoriosText = m.bedrooms === 0 ? 'Monoambiente' : `${m.bedrooms} dormitorio${m.bedrooms > 1 ? 's' : ''}`;

                return `${idx + 1}. Unidad ${m.unit_number} - Piso ${m.floor}, ${dormitoriosText}, ${m.area_total}m2 - ${precioMostrar}`;
            }).join('\n\n');

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
    }) {
        try {
            this.logger.log(`Generando proforma para: ${params.nombre_cliente}`);

            // Construir resumen formateado
            const resumen = `[ACCION_COMPLETADA] RESUMEN DE TU COTIZACION

DATOS DEL CLIENTE:
Nombre: ${params.nombre_cliente || 'N/A'}
DNI: ${params.dni || 'N/A'}
Ocupacion: ${params.ocupacion || 'N/A'}
Ingresos: ${params.ingresos || 'N/A'}

DETALLES DEL DEPARTAMENTO:
Unidad: ${params.unidad || 'N/A'}
Dormitorios: ${params.dormitorios || 'N/A'}
Area: ${params.area || 'N/A'}
Piso: ${params.piso || 'N/A'}
Precio: ${params.precio || 'N/A'}

Proforma generada. NO repitas esta herramienta.`.trim();

            return resumen;

        } catch (error) {
            this.logger.error(`Error generando proforma: ${error.message}`);
            return "Hubo un problema al generar la proforma. Por favor intenta de nuevo.";
        }
    }

    /**
     * HERRAMIENTA UNIVERSAL: Busca departamentos en Qdrant por CUALQUIER criterio
     * Puede buscar por: unidad, dormitorios, piso, precio, vista, tipología, área
     */
    async buscarDepartamentoUniversal(params: {
        unidad?: string;           // Número de unidad (ej: "1701", "305")
        dormitorios?: number;      // Cantidad de dormitorios (1, 2, 3)
        piso?: number;             // Piso específico
        precio_max?: number;       // Precio máximo
        precio_min?: number;       // Precio mínimo
        vista?: string;            // "exterior" o "interior"
        tipologia?: string;        // "Tipo 1", "Tipo 2", etc.
        area_min?: number;         // Área mínima en m2
        phoneNumber?: string;      // Número de teléfono del lead
        codigoEmpresa?: number;    // Código de empresa
        leadUuid?: string;         // UUID del lead para guardar mensaje en BD
    }) {
        try {
            const collectionName = this.configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'checor-projects-v1';

            // Construir query text para búsqueda semántica
            let queryParts = ['departamento disponible'];
            if (params.unidad) queryParts.push(`unidad ${params.unidad}`);
            if (params.dormitorios) queryParts.push(`${params.dormitorios} dormitorios`);
            if (params.piso) queryParts.push(`piso ${params.piso}`);
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
            if (params.tipologia) filters.tipologia = params.tipologia;
            if (params.area_min !== undefined) filters.areaMin = params.area_min;

            this.logger.log(`Búsqueda universal: unidad=${params.unidad}, dorms=${params.dormitorios}, piso=${params.piso}`);

            // Si busca por unidad específica, usar filtro exacto
            if (params.unidad) {
                const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                    collectionName,
                    queryText,
                    filters,
                    { limit: 20, threshold: 0.3 } // Threshold bajo para búsqueda por unidad
                );

                // Filtrar por número de unidad exacto
                const unidadExacta = resultados.find(r =>
                    r.document.metadata.unit_number?.toString() === params.unidad?.toString()
                );

                if (unidadExacta) {
                    const m = unidadExacta.document.metadata;
                    const precioMostrar = m.price_promo && parseFloat(m.price_promo) < parseFloat(m.price_list)
                        ? `S/ ${parseFloat(m.price_promo).toLocaleString('es-PE')}`
                        : `S/ ${parseFloat(m.price_list).toLocaleString('es-PE')}`;

                    const dormitoriosText = m.bedrooms === 0 ? 'Monoambiente' : `${m.bedrooms} dormitorio${m.bedrooms > 1 ? 's' : ''}`;

                    // Enviar imagen del plano si existe
                    const phoneNumber = params.phoneNumber;
                    const codigoEmpresa = params.codigoEmpresa || 1;
                    if (phoneNumber && m.url_floor_plan) {
                        const imageUrl = this.convertGoogleDriveToDirectUrl(m.url_floor_plan);
                        if (imageUrl) {
                            try {
                                await this.wapiService.sendImageByUrl(
                                    codigoEmpresa,
                                    phoneNumber,
                                    imageUrl,
                                    `Plano de la unidad ${m.unit_number}`
                                );
                                this.logger.log(`✅ Imagen del plano enviada para unidad ${m.unit_number}`);

                                // Guardar mensaje en BD si tenemos leadUuid
                                if (params.leadUuid) {
                                    try {
                                        await this.inboxService.guardarMensajeBot({
                                            leadUuid: params.leadUuid,
                                            codigoEmpresa: codigoEmpresa,
                                            contenido: `Plano de la unidad ${m.unit_number}`,
                                            tipoMultimedia: 'image',
                                            urlMultimedia: imageUrl
                                        });
                                        this.logger.log(`💾 Mensaje con imagen guardado en BD - Unidad ${m.unit_number}`);
                                    } catch (dbError) {
                                        this.logger.error(`Error guardando mensaje en BD: ${dbError.message}`);
                                    }
                                }
                            } catch (error) {
                                this.logger.error(`Error enviando imagen del plano: ${error.message}`);
                            }
                        }
                    }

                    let respuesta = `**Unidad ${m.unit_number}** - ${m.unit_type}\n` +
                        `Piso ${m.floor}\n` +
                        `${dormitoriosText}\n` +
                        `Vista ${m.view}\n` +
                        `Area total: ${m.area_total}m²\n` +
                        `Precio: ${precioMostrar}\n` +
                        `Tipologia: ${m.typology}\n` +
                        `Disponibilidad: ${m.availability}\n`;

                    // Agregar info del plano
                    if (m.url_floor_plan && phoneNumber) {
                        respuesta += `\nPLANO ENVIADO: Se envio el plano de la unidad por imagen.\n`;
                    }

                    respuesta += `\nPara asegurarte este precio y hacerte la proforma formal, indicame tu nombre completo y DNI.`;
                    return `[ACCION_COMPLETADA] ${respuesta}`;
                }

                return `[ACCION_COMPLETADA] No encontre informacion de la unidad ${params.unidad}. Pregunta si quiere ver otras opciones.`;
            }

            // Búsqueda general por otros criterios
            const resultados = await this.qdrantVectorService.searchPropertiesWithFilters(
                collectionName,
                queryText,
                filters,
                { limit: 10, threshold: 0.5 }
            );

            if (resultados.length === 0) {
                return "[ACCION_COMPLETADA] No encontre departamentos con esas caracteristicas. Pregunta si quiere ver otras opciones.";
            }

            // Mostrar lista de resultados
            const lista = resultados.map((r, idx) => {
                const m = r.document.metadata;
                const precioMostrar = m.price_promo && parseFloat(m.price_promo) < parseFloat(m.price_list)
                    ? `S/ ${parseFloat(m.price_promo).toLocaleString('es-PE')}`
                    : `S/ ${parseFloat(m.price_list).toLocaleString('es-PE')}`;

                const dormitoriosText = m.bedrooms === 0 ? 'Monoambiente' : `${m.bedrooms} dormitorio${m.bedrooms > 1 ? 's' : ''}`;

                return `${idx + 1}. Unidad ${m.unit_number} - ${dormitoriosText}, ${m.area_total}m² - Precio: ${precioMostrar}`;
            }).join('\n');

            return `[ACCION_COMPLETADA] Encontre ${resultados.length} departamento${resultados.length > 1 ? 's' : ''}:\n\n${lista}\n\nSi el cliente elige una unidad, ejecuta buscar_departamento con el numero de unidad para enviar el plano.`;

        } catch (error) {
            this.logger.error(`Error en buscarDepartamentoUniversal: ${error.message}`, error.stack);
            return "Ocurrió un error al buscar. Por favor intenta de nuevo.";
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
            await this.wapiService.sendDocument(
                codigoEmpresa,
                params.phoneNumber,
                brochurePath,
                `Brochure del proyecto ${params.nombre_proyecto}`
            );

            this.logger.log(`Brochure enviado a ${params.phoneNumber}`);

            // Guardar el mensaje en la base de datos para el inbox
            await this.inboxService.guardarMensajeBot({
                leadUuid: params.leadUuid,
                codigoEmpresa: codigoEmpresa,
                contenido: `Brochure del proyecto ${params.nombre_proyecto}`,
                tipoMultimedia: 'document',
                urlMultimedia: brochurePath
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
                        await this.wapiService.sendImageByUrl(
                            codigoEmpresa,
                            params.phoneNumber,
                            imageUrl,
                            `Plano de la unidad ${params.unidad_id}`
                        );
                        this.logger.log(`✅ Plano enviado para unidad ${params.unidad_id}`);

                        // Guardar mensaje en BD si tenemos leadUuid
                        if (params.leadUuid) {
                            try {
                                await this.inboxService.guardarMensajeBot({
                                    leadUuid: params.leadUuid,
                                    codigoEmpresa: codigoEmpresa,
                                    contenido: `Plano de la unidad ${params.unidad_id}`,
                                    tipoMultimedia: 'image',
                                    urlMultimedia: imageUrl
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
}
