import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Campania, EstadoCampania, TipoAudiencia } from './entities/campania.entity';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CampaniasService {
    private readonly logger = new Logger(CampaniasService.name);

    constructor(
        @InjectRepository(Campania)
        private campaniaRepo: Repository<Campania>,
        @InjectQueue('campanias') private campaniasQueue: Queue
    ) { }

    async crear(
        data: {
            nombre: string;
            descripcion?: string;
            plantillaId: number;
            codigoEmpresa: number;
            usuarioId?: number;
            tipoAudiencia?: TipoAudiencia;
            filtrosAudiencia?: any;
        },
        archivos?: { excel?: Express.Multer.File[]; imagen?: Express.Multer.File[] }
    ) {
        try {
            const nuevaCampania = this.campaniaRepo.create({
                ...data,
                estado: EstadoCampania.BORRADOR
            });

            // Procesar Excel
            if (archivos?.excel?.length > 0) {
                const excelFile = archivos.excel[0];
                const uploadDir = path.join(process.cwd(), 'storage', 'campaigns', 'documents');
                if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

                const fileName = `audiencia_${Date.now()}_${excelFile.originalname}`;
                const filePath = path.join(uploadDir, fileName);

                fs.writeFileSync(filePath, excelFile.buffer);

                nuevaCampania.tipoAudiencia = TipoAudiencia.EXCEL;
                nuevaCampania.archivoAudienciaPath = filePath;
            }

            // Procesar Imagen
            if (archivos?.imagen?.length > 0) {
                const imgFile = archivos.imagen[0];
                const publicDir = path.join(process.cwd(), 'public', 'campaigns', 'images');
                if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

                const fileName = `img_${Date.now()}_${imgFile.originalname}`;
                const filePath = path.join(publicDir, fileName);

                fs.writeFileSync(filePath, imgFile.buffer);

                // Guardar ruta relativa para acceso web/wapi
                nuevaCampania.imagenUrl = `/public/campaigns/images/${fileName}`;
            }

            return await this.campaniaRepo.save(nuevaCampania);
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
        const campania = await this.campaniaRepo.findOne({ where: { id, codigoEmpresa } });
        if (!campania) throw new Error('Campaña no encontrada');

        if (campania.estado === EstadoCampania.PROCESANDO) {
            throw new Error('La campaña ya se está procesando');
        }

        // Actualizar estado
        await this.campaniaRepo.update(id, { estado: EstadoCampania.PROCESANDO });

        // Añadir Job a la cola
        await this.campaniasQueue.add('procesar-audiencia', {
            campaniaId: id,
            codigoEmpresa
        }, {
            removeOnComplete: true
        });

        return { success: true, message: 'Campaña iniciada. Procesando en segundo plano.' };
    }

    async pausar(id: number) {
        await this.campaniaRepo.update(id, { estado: EstadoCampania.PAUSADO });
        return { success: true, message: 'Estado cambiado a pausado' };
    }

    async actualizar(id: number, data: any) {
        // Implementación básica de actualización
        await this.campaniaRepo.update(id, data);
        return this.obtenerPorId(id);
    }

    async eliminar(id: number) {
        await this.campaniaRepo.delete(id);
        return { success: true, message: 'Campaña eliminada' };
    }

    async cambiarEstado(id: number, nuevoEstado: string) {
        // Mapear estado legacy 'habilitado'/'deshabilitado' a enum si es necesario
        // O simplemente guardar en un campo 'active' si existiera, pero usamos 'estado' enum.
        // Si el front envía 'habilitado', podriamos mapearlo a 'PROGRAMADO' o similar

        let estadoMapped: EstadoCampania;
        if (nuevoEstado === 'habilitado') estadoMapped = EstadoCampania.PROGRAMADO;
        else if (nuevoEstado === 'deshabilitado') estadoMapped = EstadoCampania.PAUSADO;
        else estadoMapped = nuevoEstado as EstadoCampania;

        await this.campaniaRepo.update(id, { estado: estadoMapped });
        return { success: true, message: `Estado cambiado a ${nuevoEstado}` };
    }
}
