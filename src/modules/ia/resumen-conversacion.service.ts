import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SesionConversacion } from './entities/sesion-conversacion.entity';

interface SummaryRule {
    key: string;
    patterns: RegExp[];
}

/**
 * Servicio para gestionar el resumen dinámico de conversación
 * Mantiene un resumen compacto y deduplicado con la memoria operativa
 * del flujo. No guarda PII que ya vive en tbl_leads.
 */
@Injectable()
export class ResumenConversacionService {
    private readonly logger = new Logger(ResumenConversacionService.name);
    private readonly excludedPatterns: RegExp[] = [
        /^Paso 8 - Nombre completo:/i,
        /^Paso 8 - DNI:/i,
        /^Paso 11 - Email:/i,
        /^Identificado:/i,
        /^DNI capturado:/i,
        /^Email registrado:/i,
    ];
    private readonly summaryRules: SummaryRule[] = [
        { key: 'paso1_dormitorios', patterns: [/^Paso 1 - Dormitorios:/i, /^Busca depa de\s+/i] },
        { key: 'paso2_proposito', patterns: [/^Paso 2 - Proposito:/i, /^Prop[oó]sito:/i] },
        { key: 'paso2_zona', patterns: [/^Paso 2 - Zona preferida:/i, /^Zona preferida:/i] },
        { key: 'paso3_tiempo', patterns: [/^Paso 3 - Tiempo de compra:/i, /^Tiempo de compra:/i] },
        { key: 'paso4_financiamiento', patterns: [/^Paso 4 - Financiamiento:/i, /^Financiamiento:/i] },
        { key: 'paso5_presupuesto', patterns: [/^Paso 5 - Presupuesto\/Cuota:/i, /^Presupuesto\/Cuota:/i, /^Presupuesto maximo:/i] },
        { key: 'preferencia_vista', patterns: [/^Prefiere vista\s+/i] },
        { key: 'preferencia_piso', patterns: [/^Interesado en piso\s+/i] },
        { key: 'preferencia_tipo', patterns: [/^Busca tipo:\s+/i] },
        { key: 'paso6_unidad', patterns: [/^Paso 6 - Unidad de interes:/i, /^Interesado en unidad\s+/i, /^Cotiz[oó]\s+unidad\s+/i] },
        { key: 'paso9_ocupacion', patterns: [/^Paso 9 - Ocupaci[oó]n:/i, /^Ocupaci[oó]n:/i] },
        { key: 'paso9_ingresos', patterns: [/^Paso 9 - Ingresos mensuales:/i, /^Ingresos mensuales:/i] },
        { key: 'paso9_proforma', patterns: [/^Paso 9 - Proforma generada/i, /^Ya existe una proforma/i, /^Cotiz[oó]\s+unidad\s+/i] },
        { key: 'descartado', patterns: [/^Cliente descartado:/i] },
    ];

    constructor(
        @InjectRepository(SesionConversacion)
        private sesionRepo: Repository<SesionConversacion>,
    ) { }

    private normalizePoint(punto: string): string {
        return punto.replace(/^•\s*/, '').replace(/\s+/g, ' ').trim();
    }

    private shouldExcludePoint(punto: string): boolean {
        return this.excludedPatterns.some((pattern) => pattern.test(punto));
    }

    private resolveRule(punto: string): SummaryRule | undefined {
        return this.summaryRules.find((rule) => rule.patterns.some((pattern) => pattern.test(punto)));
    }

    private sortPoints(puntos: string[]): string[] {
        const order = new Map(this.summaryRules.map((rule, index) => [rule.key, index]));
        return [...puntos].sort((a, b) => {
            const indexA = order.get(this.resolveRule(a)?.key || '') ?? Number.MAX_SAFE_INTEGER;
            const indexB = order.get(this.resolveRule(b)?.key || '') ?? Number.MAX_SAFE_INTEGER;
            if (indexA !== indexB) return indexA - indexB;
            return a.localeCompare(b, 'es');
        });
    }

    private mergePoints(existingPoints: string[], incomingPoint: string): string[] {
        const punto = this.normalizePoint(incomingPoint);
        if (!punto || this.shouldExcludePoint(punto)) {
            return existingPoints.filter((item) => !this.shouldExcludePoint(item));
        }

        const cleaned = existingPoints.filter((item) => !this.shouldExcludePoint(item));
        const rule = this.resolveRule(punto);

        if (!rule) {
            if (cleaned.includes(punto)) {
                return cleaned;
            }
            return this.sortPoints([...cleaned, punto]);
        }

        const withoutSameRule = cleaned.filter((item) => !rule.patterns.some((pattern) => pattern.test(item)));
        return this.sortPoints([...withoutSameRule, punto]);
    }

    private renderSummary(points: string[]): string | null {
        const cleaned = this.sortPoints(points.filter(Boolean).map((point) => this.normalizePoint(point)).filter((point) => point && !this.shouldExcludePoint(point)));
        if (cleaned.length === 0) return null;
        return cleaned.map((point) => `• ${point}`).join('\n');
    }

    private parseSummary(summary?: string | null): string[] {
        return (summary || '')
            .split('\n')
            .map((line) => this.normalizePoint(line))
            .filter(Boolean);
    }

    /**
     * Agrega un nuevo punto al resumen existente
     * Reemplaza el valor anterior si el punto pertenece a la misma clave lógica.
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
                const puntosActuales = this.parseSummary(sesion.resumenConversacion);
                const puntosActualizados = this.mergePoints(puntosActuales, punto);
                const resumenNormalizado = this.renderSummary(puntosActualizados);

                if ((sesion.resumenConversacion || null) === resumenNormalizado) {
                    this.logger.debug(`Resumen sin cambios para lead ${leadUuid}: ${punto}`);
                    return;
                }

                sesion.resumenConversacion = resumenNormalizado;
                await this.sesionRepo.save(sesion);
                this.logger.debug(`Resumen actualizado para lead ${leadUuid}: ${punto}`);
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
