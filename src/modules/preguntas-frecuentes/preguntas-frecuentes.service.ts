import { Injectable, Logger } from '@nestjs/common';
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

    // Método Core de Sincronización
    private async syncQdrant(projectId: number) {
        const collectionName = process.env.QDRANT_COLLECTION_NAME;
        if (!collectionName) {
            this.logger.warn('No QDRANT_COLLECTION_NAME configured, skipping sync');
            return;
        }

        this.logger.log(`Iniciando sincronización Qdrant para proyecto ${projectId}...`);

        // 1. Obtener todas las FQAs del proyecto
        const allFqas = await this.fqaRepo.find({ where: { idProyecto: projectId } });

        // 2. Convertir a Documentos LangChain
        const documents: Document[] = allFqas.map(fqa => {
            // Formato de contenido para el embedding
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

        // 3. Recrear Colección (Wipe & Re-upload)
        // Esto asegura que borramos lo viejo y ponemos solo lo vigente
        await this.qdrantService.recreateCollection(collectionName);

        // 4. Subir Documentos
        if (documents.length > 0) {
            await this.qdrantService.addDocuments(collectionName, documents);
        }

        this.logger.log(`Sincronización completada. ${documents.length} documentos indexados en ${collectionName}`);
    }
}
