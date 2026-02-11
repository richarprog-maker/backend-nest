import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PreguntaFrecuente } from './entities/pregunta-frecuente.entity';
import { QdrantVectorService } from '../ia/qdrant-vector.service';
import { ProyectosService } from '../proyectos/proyectos.service';
import { Document } from '@langchain/core/documents';

@Injectable()
export class PreguntasFrecuentesService {
    private readonly logger = new Logger(PreguntasFrecuentesService.name);

    constructor(
        @InjectRepository(PreguntaFrecuente)
        private fqaRepo: Repository<PreguntaFrecuente>,
        private qdrantService: QdrantVectorService,
        @Inject(forwardRef(() => ProyectosService))
        private proyectosService: ProyectosService
    ) { }

    async getPreguntas(empresaId: number, proyectoId?: number) {
        try {
            // 1. Obtener proyectos de la empresa
            const proyectosRaw = await this.proyectosService.getProyectosPorEmpresa(empresaId);

            // Mapear al formato que espera el frontend
            const proyectosEmpresa = proyectosRaw.map(p => ({
                codigo_proyecto: p.codigoProyecto,
                nombre_proyecto: p.nombreProyecto
            }));

            // 2. Determinar proyecto activo (el solicitado o el primero)
            const activeProjectId = proyectoId ? Number(proyectoId) : (proyectosEmpresa.length > 0 ? proyectosEmpresa[0].codigo_proyecto : null);

            let fqas = [];
            let collectionName = process.env.QDRANT_COLLECTION_NAME || 'checor-default';

            if (activeProjectId) {
                const rawFqas = await this.fqaRepo.find({
                    where: { idProyecto: activeProjectId },
                    order: { orden: 'ASC' }
                });

                // Map to include id_vector alias for frontend compatibility
                fqas = rawFqas.map(f => ({
                    ...f,
                    id_vector: f.id
                }));
            }

            return {
                proyectosEmpresa,
                coleccion: {
                    id_coleccion: 1, // Dummy ID
                    coleccion_name: collectionName,
                    codigo_proyecto: activeProjectId,
                    fqas
                }
            };

        } catch (error) {
            this.logger.error(`Error getPreguntas: ${error.message}`);
            throw error;
        }
    }

    async getUniqueThemes(proyectoId: number) {
        try {
            const themes = await this.fqaRepo
                .createQueryBuilder('fqa')
                .select('DISTINCT fqa.tema', 'tema')
                .where('fqa.id_proyecto = :projectId', { projectId: proyectoId })
                .andWhere('fqa.tema IS NOT NULL')
                .andWhere("fqa.tema != ''")
                .getRawMany();

            return themes.map(t => t.tema).sort();
        } catch (error) {
            this.logger.error(`Error getUniqueThemes: ${error.message}`);
            return [];
        }
    }

    async registerFQAs(empresaId: number, data: any) {
        /*
          data: {
            codigoProyecto: number,
            questions: [ { tipo, tema, pregunta, respuesta } ]
          }
        */
        const { codigoProyecto, questions } = data;

        try {
            // 1. Guardar en MySQL
            for (const q of questions) {
                const newFqa = this.fqaRepo.create({
                    idProyecto: codigoProyecto,
                    tipo: q.tipo,
                    tema: q.tema,
                    pregunta: q.pregunta,
                    respuesta: q.respuesta,
                    orden: 0 // Default
                    // uuid se genera auto en BD o podríamos generarlo aquí
                });
                await this.fqaRepo.save(newFqa);
            }

            // 2. Sincronizar con Qdrant
            await this.syncQdrant(codigoProyecto);

            return { Status: 'Success', message: 'Preguntas registradas y sincronizadas' };

        } catch (error) {
            this.logger.error(`Error registerFQAs: ${error.message}`);
            return { Status: 'Error', message: error.message };
        }
    }

    async editFQA(id: number, data: any) {
        // data: { tipo, tema, pregunta, respuesta }
        try {
            await this.fqaRepo.update(id, {
                tipo: data.tipo,
                tema: data.tema,
                pregunta: data.pregunta,
                respuesta: data.respuesta
            });

            // Recuperar el proyecto para sincronizar
            const fqa = await this.fqaRepo.findOne({ where: { id } });
            if (fqa) {
                await this.syncQdrant(fqa.idProyecto);
            }

            return { Status: 'Success' };
        } catch (error) {
            this.logger.error(`Error editFQA: ${error.message}`);
            throw error;
        }
    }

    async deleteFQA(id: number) {
        try {
            const fqa = await this.fqaRepo.findOne({ where: { id } });
            if (!fqa) throw new Error('Pregunta no encontrada');

            const projectId = fqa.idProyecto;
            await this.fqaRepo.delete(id);

            // Sincronizar
            await this.syncQdrant(projectId);

            return { Status: 'Success' };
        } catch (error) {
            this.logger.error(`Error deleteFQA: ${error.message}`);
            throw error;
        }
    }

    async syncQdrant(projectId: number) {
        const collectionName = process.env.QDRANT_COLLECTION_NAME;
        if (!collectionName) {
            this.logger.warn('No QDRANT_COLLECTION_NAME configured, skipping sync');
            return;
        }

        this.logger.log(`Iniciando sincronización Qdrant para proyecto ${projectId}...`);

        // 1. Obtener todas las FQAs del proyecto
        const allFqas = await this.fqaRepo.find({ where: { idProyecto: projectId } });

        // 2. Convertir FAQs a Documentos LangChain
        const documents: Document[] = allFqas.map(fqa => {
            const content = `Pregunta: ${fqa.pregunta}\nRespuesta: ${fqa.respuesta}\nTema: ${fqa.tema}\nTipo: ${fqa.tipo}`;

            return new Document({
                pageContent: content,
                metadata: {
                    id_pregunta: fqa.id,
                    tipo: fqa.tipo,
                    tema: fqa.tema,
                    origen: 'faq-db'
                }
            });
        });

        // 3. Obtener info del proyecto y convertirla a documentos
        const proyectoInfo = await this.proyectosService.getProyectoInfo(projectId, null);
        if (proyectoInfo) {
            const infoDocuments = this.buildProjectInfoDocuments(proyectoInfo);
            documents.push(...infoDocuments);
        }

        // 4. Recrear Colección (Wipe & Re-upload)
        await this.qdrantService.recreateCollection(collectionName);

        // 5. Subir Documentos
        if (documents.length > 0) {
            await this.qdrantService.addDocuments(collectionName, documents);
        }

        this.logger.log(`Sincronización completada. ${documents.length} documentos indexados en ${collectionName}`);
    }

    private buildProjectInfoDocuments(info: any): Document[] {
        const docs: Document[] = [];
        const tema = 'Información del Proyecto';

        const fields: { pregunta: string; key: string; formatter?: (val: any) => string }[] = [
            { pregunta: '¿Cuál es el nombre del proyecto?', key: 'nombre_proyecto' },
            { pregunta: '¿De qué trata el proyecto? ¿Qué es el proyecto?', key: 'acerca_proyecto' },
            { pregunta: '¿Cuál es la fecha estimada de entrega del proyecto?', key: 'fecha_estimada_entrega' },
            { pregunta: '¿Qué tipos de unidades tiene el proyecto?', key: 'tipos_unidades' },
            { pregunta: '¿En qué etapa se encuentra el proyecto actualmente?', key: 'etapa_actual' },
            { pregunta: '¿Cuál es la dirección del proyecto?', key: 'direccion_proyecto' },
            { pregunta: '¿Dónde queda la sala de ventas?', key: 'direccion_sala_ventas' },
            {
                pregunta: '¿Cuál es el horario de atención?',
                key: 'horario_atencion',
                formatter: (val) => {
                    if (!val) return '';
                    const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                    const horarios = Array.isArray(val) ? val : [val];
                    return horarios.map(h => {
                        const diaInicio = dias[h.num_dia_semana_inicio] || h.num_dia_semana_inicio;
                        const diaFin = dias[h.num_dia_semana_fin] || h.num_dia_semana_fin;
                        return `${diaInicio} a ${diaFin}: ${h.hora_inicio} - ${h.hora_fin}`;
                    }).join('. ');
                }
            },
            { pregunta: '¿Cuántas unidades disponibles hay?', key: 'unidades_disponibles' },
            { pregunta: '¿Hay recorrido virtual del proyecto?', key: 'recorrido_virtual' },
            { pregunta: '¿Hay exhibición de unidades? ¿Se puede visitar un departamento piloto?', key: 'exhibicion_unidades' },
        ];

        for (const field of fields) {
            const rawValue = info[field.key];
            if (!rawValue) continue;

            const respuesta = field.formatter ? field.formatter(rawValue) : String(rawValue);
            if (!respuesta.trim()) continue;

            const content = `Pregunta: ${field.pregunta}\nRespuesta: ${respuesta}\nTema: ${tema}\nTipo: Información del Proyecto`;

            docs.push(new Document({
                pageContent: content,
                metadata: {
                    pregunta: field.pregunta,
                    respuesta: respuesta,
                    tipo: 'Información del Proyecto',
                    tema: tema,
                    origen: 'info-proyecto'
                }
            }));
        }

        return docs;
    }
}
