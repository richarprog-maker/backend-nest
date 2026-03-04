import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Campania, EstadoCampania, TipoAudiencia } from './entities/campania.entity';
import { CampaniaProgramada, EstadoCampaniaProgramada } from './entities/campania-programada.entity';
import { MetaTemplatesService } from '../plantillas-campanias/services/meta-templates.service';
import { PlantillasCampaniasService } from '../plantillas-campanias/plantillas-campanias.service';
import * as fs from 'fs';
import * as path from 'path';

function sanitizeFileName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Quitar tildes: á→a, ó→o, etc.
        .replace(/ñ/gi, 'n')
        .replace(/[^a-zA-Z0-9._-]/g, '_') // Solo caracteres seguros para URL
        .replace(/_+/g, '_'); // Colapsar múltiples guiones bajos
}

@Injectable()
export class CampaniasService {
    private readonly logger = new Logger(CampaniasService.name);

    constructor(
        @InjectRepository(Campania)
        private campaniaRepo: Repository<Campania>,
        @InjectRepository(CampaniaProgramada)
        private programadaRepo: Repository<CampaniaProgramada>,
        @InjectQueue('campanias') private campaniasQueue: Queue,
        private metaTemplatesService: MetaTemplatesService,
        private plantillasCampaniasService: PlantillasCampaniasService
    ) { }

    async crear(
        data: {
            nombre: string;
            descripcion?: string;
            plantillaId?: number;
            plantillaNombre?: string;
            plantillaContenido?: string;
            plantillaParametros?: string[];
            codigoEmpresa: number;
            usuarioId?: number;
            proyectoId?: number;
            tipoAudiencia?: TipoAudiencia;
            filtrosAudiencia?: any;
            fechaProgramada?: string;
        },
        archivos?: { excel?: Express.Multer.File[]; imagen?: Express.Multer.File[] }
    ) {
        try {
            // Determinar si es una plantilla nueva antes de procesar, ya que data.plantillaId cambiará
            const esPlantillaNueva = !!(data.plantillaContenido && !data.plantillaId);

            let urlMultimedia: string = null;
            let tipoMultimedia: string = 'ninguno';

            if (archivos?.imagen?.length > 0) {
                const imgFile = archivos.imagen[0];
                const storageDir = path.join(process.cwd(), 'storage', 'multimedia', 'campaigns');
                if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

                const fileName = `img_${Date.now()}_${sanitizeFileName(imgFile.originalname)}`;
                const filePath = path.join(storageDir, fileName);

                fs.writeFileSync(filePath, imgFile.buffer);
                urlMultimedia = `/storage/multimedia/campaigns/${fileName}`;

                // Detectar tipo de archivo por extensión
                const extension = imgFile.originalname.split('.').pop().toLowerCase();
                const videoExtensions = ['mp4', '3gp', 'avi', 'mov', 'mkv', 'webm'];
                const docExtensions = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt'];

                if (videoExtensions.includes(extension)) {
                    tipoMultimedia = 'video';
                } else if (docExtensions.includes(extension)) {
                    tipoMultimedia = 'documento';
                } else {
                    tipoMultimedia = 'imagen';
                }
            }

            if (esPlantillaNueva) {
                this.logger.log(`Creando plantilla automáticamente para campaña "${data.nombre}"`);

                const nombrePlantilla = data.plantillaNombre || `Plantilla ${data.nombre}`;

                const plantilla = await this.plantillasCampaniasService.crear({
                    nombre: nombrePlantilla,
                    contenido: data.plantillaContenido,
                    parametros: data.plantillaParametros || [],
                    idioma: 'es_PE',
                    codigo_canal: 'whatsapp',
                    codigo_empresa: data.codigoEmpresa,
                    tipo_contenido_multimedia: tipoMultimedia,
                    url_multimedia: urlMultimedia
                });

                data.plantillaId = plantilla.id;

                try {
                    await this.metaTemplatesService.crearPlantillaEnMeta(plantilla.id, data.codigoEmpresa);
                } catch (metaError) {
                    this.logger.error(`Error al intentar crear plantilla en Meta: ${metaError.message}`);
                }
            }

            const nuevaCampania = this.campaniaRepo.create({
                ...data,
                estado: EstadoCampania.PROGRAMADO,
                stats: { total: 0, enviados: 0, fallidos: 0 },
                imagenUrl: urlMultimedia
            });

            if (archivos?.excel?.length > 0) {
                const excelFile = archivos.excel[0];
                const uploadDir = path.join(process.cwd(), 'storage', 'campaigns', 'documents');
                if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

                const fileName = `audiencia_${Date.now()}_${sanitizeFileName(excelFile.originalname)}`;
                const filePath = path.join(uploadDir, fileName);

                fs.writeFileSync(filePath, excelFile.buffer);

                nuevaCampania.tipoAudiencia = TipoAudiencia.EXCEL;
                nuevaCampania.archivoAudienciaPath = filePath;
            }

            const campaniaGuardada = await this.campaniaRepo.save(nuevaCampania);

            // Siempre crear registro de programación (ya no hay estado borrador)
            const fechaProg = data.fechaProgramada ? new Date(data.fechaProgramada) : new Date();

            this.logger.log(`Programando campaña ID ${campaniaGuardada.id}. Fecha: ${fechaProg}`);

            await this.programadaRepo.save({
                campaniaId: campaniaGuardada.id,
                fechaProgramada: fechaProg,
                codigoEmpresa: data.codigoEmpresa,
                estado: EstadoCampaniaProgramada.PENDIENTE
            });

            await this.campaniaRepo.update(campaniaGuardada.id, {
                fechaProgramada: fechaProg
            });

            this.logger.log(`Campaña ${campaniaGuardada.id} programada para ${fechaProg}`);

            return campaniaGuardada;
        } catch (error) {
            this.logger.error(`Error al crear campaña: ${error.message}`);
            throw error;
        }
    }

    async listar(codigoEmpresa: number) {
        return this.campaniaRepo.find({
            where: { codigoEmpresa },
            order: { createdAt: 'DESC' },
            relations: ['plantilla']
        });
    }

    async obtenerPorId(id: number) {
        return this.campaniaRepo.findOne({
            where: { id },
            relations: ['plantilla']
        });
    }

    async lanzar(id: number, codigoEmpresa: number) {
        const campania = await this.campaniaRepo.findOne({
            where: { id, codigoEmpresa },
            relations: ['plantilla']
        });
        if (!campania) throw new Error('Campaña no encontrada');

        if (campania.estado === EstadoCampania.PROCESANDO) {
            throw new Error('La campaña ya se está procesando');
        }

        // Verificar plantilla aprobada
        if (campania.plantilla && campania.plantilla.metaStatus === 'REJECTED') {
            throw new Error('La plantilla fue rechazada por Meta. Edítala y reenvía.');
        }

        await this.campaniaRepo.update(id, { estado: EstadoCampania.PROCESANDO });

        await this.campaniasQueue.add('procesar-audiencia', {
            campaniaId: id,
            codigoEmpresa
        }, {
            removeOnComplete: true
        });

        return { success: true, message: 'Campaña iniciada. Procesando en segundo plano.' };
    }

    async crearPlantillaEnMeta(plantillaId: number, codigoEmpresa: number) {
        return this.metaTemplatesService.crearPlantillaEnMeta(plantillaId, codigoEmpresa);
    }

    async sincronizarPlantillas(codigoEmpresa: number) {
        return this.metaTemplatesService.sincronizarPlantillas(codigoEmpresa);
    }

    async pausar(id: number) {
        await this.campaniaRepo.update(id, { estado: EstadoCampania.PAUSADO });
        return { success: true, message: 'Estado cambiado a pausado' };
    }

    async actualizar(id: number, data: any) {
        await this.campaniaRepo.update(id, data);
        return this.obtenerPorId(id);
    }

    async eliminar(id: number) {
        await this.campaniaRepo.delete(id);
        return { success: true, message: 'Campaña eliminada' };
    }

    async cambiarEstado(id: number, nuevoEstado: string) {
        let estadoMapped: EstadoCampania;

        // Toggle del frontend: habilitado/deshabilitado
        if (nuevoEstado === 'habilitado' || nuevoEstado === 'activo') {
            estadoMapped = EstadoCampania.PROGRAMADO;
        } else if (nuevoEstado === 'deshabilitado' || nuevoEstado === 'pausado') {
            estadoMapped = EstadoCampania.PAUSADO;
        } else {
            estadoMapped = nuevoEstado as EstadoCampania;
        }

        await this.campaniaRepo.update(id, { estado: estadoMapped });

        // Si se activa una campaña pausada, verificar si tiene programación pendiente
        if (estadoMapped === EstadoCampania.PROGRAMADO) {
            const programada = await this.programadaRepo.findOne({
                where: { campaniaId: id, estado: EstadoCampaniaProgramada.PENDIENTE }
            });

            // Si no tiene programación o fue cancelada, recrearla
            if (!programada) {
                const campania = await this.campaniaRepo.findOne({ where: { id } });
                if (campania) {
                    await this.programadaRepo.save({
                        campaniaId: id,
                        fechaProgramada: campania.fechaProgramada || new Date(),
                        codigoEmpresa: campania.codigoEmpresa,
                        estado: EstadoCampaniaProgramada.PENDIENTE
                    });
                    this.logger.log(`Campaña ${id} reactivada y reprogramada`);
                }
            }
        }

        return {
            success: true,
            message: `Campaña ${estadoMapped === EstadoCampania.PROGRAMADO ? 'activada' : 'pausada'}`,
            estado: estadoMapped
        };
    }

    // Método para listar plantillas disponibles
    async listarPlantillas(codigoEmpresa: number) {
        return this.plantillasCampaniasService.obtenerTodas(codigoEmpresa);
    }

    async listarPlantillasMeta(codigoEmpresa: number) {
        return this.metaTemplatesService.listarPlantillasMeta(codigoEmpresa);
    }

    async verificarEstadoPlantilla(plantillaId: number, codigoEmpresa: number) {
        try {
            const plantilla = await this.plantillasCampaniasService.obtenerPorId(plantillaId);

            if (!plantilla) {
                throw new Error('Plantilla no encontrada');
            }

            if (!plantilla.metaTemplateId && plantilla.metaStatus !== 'LOCAL') {
                return {
                    success: false,
                    message: 'La plantilla no ha sido sincronizada con Meta aún',
                    plantilla
                };
            }

            const plantillasMeta = await this.metaTemplatesService.listarPlantillasMeta(codigoEmpresa);

            let plantillaMeta = null;

            if (plantilla.metaTemplateId) {
                plantillaMeta = plantillasMeta.find((pm: any) => pm.id === plantilla.metaTemplateId);
            }

            if (!plantillaMeta && plantilla.metaStatus === 'LOCAL') {
                const nombreNormalizado = this.normalizeName(plantilla.nombre);
                plantillaMeta = plantillasMeta.find((pm: any) => pm.name === nombreNormalizado);

                if (plantillaMeta) {
                    this.logger.log(`¡Match por nombre encontrado! Vinculando "${plantilla.nombre}" con ID Meta ${plantillaMeta.id}`);
                }
            }

            if (!plantillaMeta) {
                if (plantilla.metaTemplateId) {
                    await this.plantillasCampaniasService.actualizarEstadoMeta(
                        plantilla.id,
                        'REJECTED',
                        plantilla.metaTemplateId,
                        'Plantilla no encontrada en Meta API (posiblemente eliminada)'
                    );
                }

                return {
                    success: false,
                    message: 'Plantilla no encontrada en Meta',
                    plantilla: await this.plantillasCampaniasService.obtenerPorId(plantillaId)
                };
            }

            // Mapear estado de Meta
            const mapearEstado = (estadoMeta: string): string => {
                const mapa: Record<string, string> = {
                    'APPROVED': 'APPROVED',
                    'PENDING': 'PENDING',
                    'REJECTED': 'REJECTED',
                    'IN_APPEAL': 'PENDING',
                    'PENDING_DELETION': 'REJECTED',
                    'DISABLED': 'REJECTED',
                    'PAUSED': 'REJECTED'
                };
                return mapa[estadoMeta] || 'PENDING';
            };

            const nuevoEstado = mapearEstado(plantillaMeta.status);

            await this.plantillasCampaniasService.actualizarEstadoMeta(
                plantilla.id,
                nuevoEstado,
                plantillaMeta.id,
                plantillaMeta.quality_score?.reasons?.join(', ') || null
            );

            this.logger.log(
                `Plantilla "${plantilla.nombre}" actualizada: ${plantilla.metaStatus} -> ${nuevoEstado}`
            );

            return {
                success: true,
                message: 'Estado actualizado correctamente',
                plantilla: await this.plantillasCampaniasService.obtenerPorId(plantillaId),
                metaData: {
                    status: plantillaMeta.status,
                    name: plantillaMeta.name,
                    language: plantillaMeta.language,
                    category: plantillaMeta.category,
                    quality_score: plantillaMeta.quality_score
                }
            };
        } catch (error) {
            this.logger.error(`Error verificando estado de plantilla ${plantillaId}: ${error.message}`);
            throw error;
        }
    }

    private normalizeName(nombre: string): string {
        return nombre
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .substring(0, 512);
    }
}
