import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Proyecto } from './entities/proyecto.entity';
import { VendedorProyecto } from './entities/asesor-proyecto.entity';
import { PreguntasFrecuentesService } from '../preguntas-frecuentes/preguntas-frecuentes.service';

@Injectable()
export class ProyectosService {
    private readonly logger = new Logger(ProyectosService.name);

    constructor(
        @InjectRepository(Proyecto)
        private proyectoRepo: Repository<Proyecto>,
        @InjectRepository(VendedorProyecto)
        private vendedorProyectoRepo: Repository<VendedorProyecto>,
        @Inject(forwardRef(() => PreguntasFrecuentesService))
        private preguntasFrecuentesService: PreguntasFrecuentesService,
    ) { }

    async getProyectosPorEmpresa(codigoEmpresa: number) {
        try {
            const proyectos = await this.proyectoRepo.find({
                where: { codigoEmpresa, estado: 'activo' }
            });

            return proyectos.map(p => ({
                codigoProyecto: p.id,
                nombreProyecto: p.nombre,
            }));
        } catch (error) {
            this.logger.error(`Error obteniendo proyectos empresa ${codigoEmpresa}: ${error.message}`);
            throw error;
        }
    }

    async getProyectoInfo(id: number, codigoEmpresa: number | null) {
        try {
            const where: any = { id };
            if (codigoEmpresa) where.codigoEmpresa = codigoEmpresa;

            const proyecto = await this.proyectoRepo.findOne({ where });

            if (!proyecto) {
                return null;
            }

            const jsonData = proyecto.jsonData || {};

            return {
                codigo_proyecto: proyecto.id,
                nombre_proyecto: proyecto.nombre,
                acerca_proyecto: proyecto.descripcion,
                fecha_estimada_entrega: jsonData.fecha_estimada_entrega || '',
                tipos_unidades: jsonData.tipos_unidades || proyecto.tipoInmueble,
                exhibicion_unidades: jsonData.exhibicion_unidades || '',
                etapa_actual: jsonData.etapa_actual || '',
                direccion_proyecto: proyecto.ubicacion,
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

            if (data.nombre_proyecto) proyecto.nombre = data.nombre_proyecto;
            if (data.acerca_proyecto) proyecto.descripcion = data.acerca_proyecto;
            if (data.direccion_proyecto) proyecto.ubicacion = data.direccion_proyecto;

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

            try {
                await this.preguntasFrecuentesService.syncQdrant(id);
                this.logger.log(`Qdrant sincronizado despues de actualizar proyecto ${id}`);
            } catch (syncError) {
                this.logger.error(`Error sincronizando Qdrant: ${syncError.message}`);
            }

            return { success: true, message: 'Proyecto actualizado correctamente' };

        } catch (error) {
            this.logger.error(`Error actualizando proyecto ${id}: ${error.message}`);
            throw error;
        }
    }

    async obtenerVendedoresPorProyecto(proyectoId: number) {
        try {
            const asignaciones = await this.vendedorProyectoRepo.find({
                where: { proyectoId },
                relations: ['vendedor', 'proyecto']
            });
            return asignaciones;
        } catch (error) {
            this.logger.error(`Error obteniendo vendedores del proyecto ${proyectoId}: ${error.message}`);
            throw error;
        }
    }

    async asignarVendedor(proyectoId: number, idVendedor: number) {
        try {
            const existente = await this.vendedorProyectoRepo.findOne({
                where: { proyectoId, idVendedor }
            });
            if (existente) {
                return { success: false, message: 'El vendedor ya esta asignado a este proyecto' };
            }

            // Validar máximo de 2 responsables por proyecto
            const totalAsignados = await this.vendedorProyectoRepo.count({ where: { proyectoId } });
            if (totalAsignados >= 2) {
                return {
                    success: false,
                    message: 'El proyecto ya tiene 2 responsables asignados. Desasigna uno antes de agregar otro.'
                };
            }

            const asignacion = this.vendedorProyectoRepo.create({ proyectoId, idVendedor });
            await this.vendedorProyectoRepo.save(asignacion);
            return { success: true, message: 'Vendedor asignado correctamente' };
        } catch (error) {
            this.logger.error(`Error asignando vendedor: ${error.message}`);
            throw error;
        }
    }

    async desasignarVendedor(proyectoId: number, idVendedor: number) {
        try {
            await this.vendedorProyectoRepo.delete({ proyectoId, idVendedor });
            return { success: true, message: 'Vendedor desasignado correctamente' };
        } catch (error) {
            this.logger.error(`Error desasignando vendedor: ${error.message}`);
            throw error;
        }
    }

    async obtenerProyectosPorVendedor(idVendedor: number) {
        try {
            const asignaciones = await this.vendedorProyectoRepo.find({
                where: { idVendedor },
                relations: ['proyecto']
            });
            return asignaciones.map(a => ({
                codigoProyecto: a.proyecto.id,
                nombreProyecto: a.proyecto.nombre,
            }));
        } catch (error) {
            this.logger.error(`Error obteniendo proyectos del vendedor ${idVendedor}: ${error.message}`);
            throw error;
        }
    }
}
