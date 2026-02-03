import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SesionConversacion } from './entities/sesion-conversacion.entity';

/**
 * Servicio para gestionar el resumen dinámico de conversación
 * Acumula bullet points con información clave del cliente
 */
@Injectable()
export class ResumenConversacionService {
    private readonly logger = new Logger(ResumenConversacionService.name);

    constructor(
        @InjectRepository(SesionConversacion)
        private sesionRepo: Repository<SesionConversacion>,
    ) { }

    /**
     * Agrega un nuevo punto al resumen existente
     * Formato: "• [punto]"
     */
    async agregarPunto(
        leadUuid: string,
        codigoEmpresa: number,
        punto: string
    ): Promise<void> {
        try {
            const sesion = await this.sesionRepo.findOne({
                where: { leadUuid, codigoEmpresa }
            });

            if (sesion) {
                const resumenActual = sesion.resumenConversacion || '';
                const nuevoPunto = `• ${punto}`;

                // Evitar duplicados exactos
                if (resumenActual.includes(punto)) {
                    this.logger.debug(`Punto ya existe en resumen, omitiendo: ${punto}`);
                    return;
                }

                sesion.resumenConversacion = resumenActual
                    ? `${resumenActual}\n${nuevoPunto}`
                    : nuevoPunto;

                await this.sesionRepo.save(sesion);
                this.logger.debug(`Resumen actualizado para lead ${leadUuid}: ${nuevoPunto}`);
            }
        } catch (error) {
            this.logger.error(`Error actualizando resumen: ${error.message}`);
            // No lanzamos error para no interrumpir el flujo principal
        }
    }

    /**
     * Agrega múltiples puntos de una vez
     */
    async agregarPuntos(
        leadUuid: string,
        codigoEmpresa: number,
        puntos: string[]
    ): Promise<void> {
        for (const punto of puntos) {
            if (punto && punto.trim()) {
                await this.agregarPunto(leadUuid, codigoEmpresa, punto.trim());
            }
        }
    }

    /**
     * Obtiene el resumen actual de un lead
     */
    async obtenerResumen(
        leadUuid: string,
        codigoEmpresa: number
    ): Promise<string | null> {
        const sesion = await this.sesionRepo.findOne({
            where: { leadUuid, codigoEmpresa }
        });
        return sesion?.resumenConversacion || null;
    }
}
