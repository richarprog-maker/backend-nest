import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campania } from './entities/campania.entity';
import { CampaniaDetalle, EstadoCampaniaDetalle } from './entities/campania-detalle.entity';
import { WapiService } from '../webhook_meta/wapi.service';
import * as xlsx from 'xlsx';
import * as fs from 'fs';

@Processor('campanias')
export class CampaniasProcessor extends WorkerHost {
    private readonly logger = new Logger(CampaniasProcessor.name);

    constructor(
        @InjectRepository(Campania)
        private campaniaRepo: Repository<Campania>,
        @InjectRepository(CampaniaDetalle)
        private detalleRepo: Repository<CampaniaDetalle>,
        private wapiService: WapiService,
        @InjectQueue('campanias') private campaniasQueue: Queue
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

    // -------------------------------------------------------------------------
    // PROCESAMIENTO DE AUDIENCIA (Genera los detalles)
    // -------------------------------------------------------------------------
    private async handleProcesarAudiencia(data: { campaniaId: number }) {
        const { campaniaId } = data;
        this.logger.log(`Inicio procesamiento audiencia para campaña #${campaniaId}`);

        try {
            const campania = await this.campaniaRepo.findOne({
                where: { id: campaniaId },
                relations: ['plantilla']
            });

            if (!campania) throw new Error('Campaña no encontrada');

            let destinatarios: any[] = [];

            if (campania.tipoAudiencia === 'excel' && campania.archivoAudienciaPath) {
                // Leer Excel
                if (fs.existsSync(campania.archivoAudienciaPath)) {
                    const workbook = xlsx.readFile(campania.archivoAudienciaPath);
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rawData = xlsx.utils.sheet_to_json(sheet);

                    // Normalizar datos (buscar columnas clave)
                    destinatarios = rawData.map((row: any) => ({
                        telefono: row['telefono'] || row['celular'] || row['movil'] || row['Telefono'] || row['Celular'],
                        nombre: row['nombre'] || row['nombres'] || row['Nombre'] || '',
                        variables: row // Guardamos todo por si acaso
                    })).filter(d => d.telefono); // Filtrar sin telefono
                } else {
                    throw new Error('Archivo de audiencia no existe en disco');
                }
            } else if (campania.tipoAudiencia === 'base_datos') {
                // TODO: Implementar lógica de filtros a BD si aplica
                // Por ahora asumimos que no se usa o se implementará después
                this.logger.warn('Tipo audiencia base_datos no implementado completamente aún');
            }

            this.logger.log(`Se encontraron ${destinatarios.length} destinatarios para la campaña #${campaniaId}`);

            // Insertar masivamente en CampaniaDetalle
            // Nota: Para miles de registros, hacer batch insert (chunks de 100 o 500)
            const chunkSize = 100;

            for (let i = 0; i < destinatarios.length; i += chunkSize) {
                const chunk = destinatarios.slice(i, i + chunkSize);

                const entities = chunk.map(d => this.detalleRepo.create({
                    campaniaId: campania.id,
                    telefono: String(d.telefono).trim().replace(/\D/g, ''), // Limpiar telefono
                    nombre: d.nombre,
                    variables: d.variables,
                    estado: EstadoCampaniaDetalle.PENDIENTE,
                    tipoMultimedia: campania.imagenUrl ? 'image' : 'none',
                    urlMultimedia: campania.imagenUrl
                }));

                const savedChunk = await this.detalleRepo.save(entities);

                const jobs = savedChunk.map(detalle => ({
                    name: 'enviar-mensaje',
                    data: {
                        detalleId: detalle.id,
                        plantillaCuerpo: campania.plantilla?.contenido,
                        codigoEmpresa: campania.codigoEmpresa
                    },
                    opts: {
                        removeOnComplete: true, // No llenar Redis de metadatos
                        delay: 100 * (i / chunkSize) // Pequeño delay escalonado para no saturar 
                    }
                }));

                await this.campaniasQueue.addBulk(jobs);
            }

            return { success: true, count: destinatarios.length };

        } catch (error) {
            this.logger.error(`Error procesando audiencia: ${error.message}`);
            throw error;
        }
    }

    // -------------------------------------------------------------------------
    // ENVÍO DE MENSAJE INDIVIDUAL
    // -------------------------------------------------------------------------
    private async handleEnviarMensaje(data: { detalleId: number, plantillaCuerpo: string, codigoEmpresa: number }) {
        const { detalleId, plantillaCuerpo, codigoEmpresa } = data;

        try {
            const detalle = await this.detalleRepo.findOne({ where: { id: detalleId } });
            if (!detalle) return;

            // Personalizar mensaje si aplica
            const mensajeFinal = this.reemplazarVariables(plantillaCuerpo || '', detalle.variables);

            let response;

            // Enviar según tipo
            if (detalle.tipoMultimedia === 'image' && detalle.urlMultimedia) {
                // Ruta absoluta o relativa? WapiService espera ruta relativa "storage/..." o absoluta si empieza con /
                // El plan dice guardar en public. WapiService usa fs.readFileSync(filePath).
                // Debemos asegurar que urlMultimedia sea path de sistema de archivos.

                // Si urlMultimedia es "/public/campaigns/img.jpg", pasamos "public/campaigns/img.jpg" (sin slash inicial si es relativo a cwd)
                const fsPath = detalle.urlMultimedia.startsWith('/') ? `.${detalle.urlMultimedia}` : detalle.urlMultimedia;

                response = await this.wapiService.sendImage(codigoEmpresa, detalle.telefono, fsPath, mensajeFinal);
            } else {
                response = await this.wapiService.sendMessage(codigoEmpresa, detalle.telefono, mensajeFinal);
            }

            // Actualizar estado
            if (response && !response.error) {
                const wamid = response?.messages?.[0]?.id || response?.id;
                await this.detalleRepo.update(detalleId, {
                    estado: EstadoCampaniaDetalle.ENVIADO,
                    wamid: wamid,
                    updatedAt: new Date() // Forzar update
                });
                // TODO: Insertar en Log de Mensajes (Inbox) si se requiere
            } else {
                await this.detalleRepo.update(detalleId, {
                    estado: EstadoCampaniaDetalle.FALLIDO,
                    errorLog: JSON.stringify(response?.details || response),
                    updatedAt: new Date()
                });
            }

        } catch (error) {
            this.logger.error(`Error enviando mensaje ${detalleId}: ${error.message}`);
            await this.detalleRepo.update(detalleId, {
                estado: EstadoCampaniaDetalle.FALLIDO,
                errorLog: error.message
            });
        }
    }

    private reemplazarVariables(texto: string, variables: any): string {
        if (!variables) return texto;
        let resultado = texto;
        // Variables tipo {{nombre}}
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'gi');
            resultado = resultado.replace(regex, variables[key]);
        });
        return resultado;
    }

    @OnWorkerEvent('completed')
    onCompleted(job: Job) {
        // this.logger.log(`Job completado: ${job.name}`);
    }
}
