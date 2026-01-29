import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Proyecto } from './entities/proyecto.entity';

@Injectable()
export class ProyectosService {
    private readonly logger = new Logger(ProyectosService.name);

    constructor(
        @InjectRepository(Proyecto)
        private proyectoRepo: Repository<Proyecto>,
    ) { }

    async getProyectosPorEmpresa(codigoEmpresa: number) {
        try {
            const proyectos = await this.proyectoRepo.find({
                where: { codigoEmpresa, estado: 'activo' }
            });

            // Mapear al formato esperado por el frontend
            return proyectos.map(p => ({
                codigoProyecto: p.id,
                nombreProyecto: p.nombre,
                // Otros campos si fueran necesarios
            }));
        } catch (error) {
            this.logger.error(`Error obteniendo proyectos empresa ${codigoEmpresa}: ${error.message}`);
            throw error;
        }
    }

    async getProyectoInfo(id: number, codigoEmpresa: number) {
        try {
            const proyecto = await this.proyectoRepo.findOne({
                where: { id, codigoEmpresa }
            });

            if (!proyecto) {
                return null;
            }

            // Extraer datos del json_data si existen
            const jsonData = proyecto.jsonData || {};

            return {
                codigo_proyecto: proyecto.id,
                nombre_proyecto: proyecto.nombre,
                acerca_proyecto: proyecto.descripcion,
                fecha_estimada_entrega: jsonData.fecha_estimada_entrega || '',
                tipos_unidades: jsonData.tipos_unidades || proyecto.tipoInmueble,
                exhibicion_unidades: jsonData.exhibicion_unidades || '',
                etapa_actual: jsonData.etapa_actual || '',

                // Direcciones
                direccion_proyecto: proyecto.ubicacion, // En BD se guarda unificado o separado, aquí devolvemos lo que hay
                direccion_sala_ventas: jsonData.direccion_sala_ventas || '',

                horario_atencion: jsonData.horario_atencion,
                unidades_disponibles: jsonData.unidades_disponibles,
                recorrido_virtual: jsonData.recorrido_virtual
            };
        } catch (error) {
            this.logger.error(`Error obteniendo info proyecto ${id}: ${error.message}`);
            throw error;
        }
    }

    async updateProyecto(id: number, codigoEmpresa: number, data: any) {
        try {
            const proyecto = await this.proyectoRepo.findOne({
                where: { id, codigoEmpresa }
            });

            if (!proyecto) {
                throw new Error('Proyecto no encontrado');
            }

            // Actualizar campos base
            if (data.nombre_proyecto) proyecto.nombre = data.nombre_proyecto;
            if (data.acerca_proyecto) proyecto.descripcion = data.acerca_proyecto;
            if (data.direccion_proyecto) proyecto.ubicacion = data.direccion_proyecto;

            // Actualizar JSON Data preservando lo existente
            const currentJson = proyecto.jsonData || {};
            const newJson = {
                ...currentJson,
                fecha_estimada_entrega: data.fecha_estimada_entrega,
                tipos_unidades: data.tipos_unidades,
                exhibicion_unidades: data.exhibicion_unidades,
                etapa_actual: data.etapa_actual,
                direccion_sala_ventas: data.direccion_sala_ventas,
                horario_atencion: data.horario_atencion,
                unidades_disponibles: data.unidades_disponibles,
                recorrido_virtual: data.recorrido_virtual
            };

            proyecto.jsonData = newJson;

            await this.proyectoRepo.save(proyecto);
            return { success: true, message: 'Proyecto actualizado correctamente' };

        } catch (error) {
            this.logger.error(`Error actualizando proyecto ${id}: ${error.message}`);
            throw error;
        }
    }
}
