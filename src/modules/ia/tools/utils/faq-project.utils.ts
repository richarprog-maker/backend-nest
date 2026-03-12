import { Document } from '@langchain/core/documents';
import { Proyecto } from '../../../proyectos/entities/proyecto.entity';

export interface FaqDocumentResult {
    document: Document;
    score: number;
    proyectoId: number;
    nombreProyecto: string;
    collectionName: string;
}

export function normalizeToolText(value: string): string {
    return (value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function convertirTextoNumeroAIndice(token: string, totalProyectos: number): number | null {
    const limpio = normalizeToolText(token);
    if (!limpio) {
        return null;
    }

    const numerico = Number(limpio);
    if (!Number.isNaN(numerico) && numerico >= 1 && numerico <= totalProyectos) {
        return numerico - 1;
    }

    const cardinales = [
        'uno', 'dos', 'tres', 'cuatro', 'cinco',
        'seis', 'siete', 'ocho', 'nueve', 'diez',
        'once', 'doce', 'trece', 'catorce', 'quince',
        'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'
    ];
    const ordinales = [
        'primer', 'primero', 'segundo', 'tercero', 'cuarto', 'quinto',
        'sexto', 'septimo', 'octavo', 'noveno', 'decimo',
        'undecimo', 'duodecimo', 'decimotercero', 'decimocuarto', 'decimoquinto',
        'decimosexto', 'decimoseptimo', 'decimooctavo', 'decimonoveno', 'vigesimo'
    ];

    const cardinalIndex = cardinales.indexOf(limpio);
    if (cardinalIndex >= 0 && cardinalIndex < totalProyectos) {
        return cardinalIndex;
    }

    const ordinalIndex = ordinales.indexOf(limpio);
    if (ordinalIndex >= 0 && ordinalIndex < totalProyectos) {
        return ordinalIndex;
    }

    return null;
}

function extraerIndicesProyecto(textoNormalizado: string, totalProyectos: number): number[] {
    const indices = new Set<number>();
    const patrones = [
        /\bproyecto\s+([a-z0-9]+)\b/g,
        /\b([a-z0-9]+)\s+proyecto\b/g,
    ];

    for (const regex of patrones) {
        for (const match of textoNormalizado.matchAll(regex)) {
            const index = convertirTextoNumeroAIndice(match[1], totalProyectos);
            if (index !== null) {
                indices.add(index);
            }
        }
    }

    return Array.from(indices.values()).sort((a, b) => a - b);
}

export function resolveMentionedProjects(
    textoNormalizado: string,
    proyectosActivos: Proyecto[],
    nombreProyecto?: string
): Proyecto[] {
    const proyectos = new Map<number, Proyecto>();
    const nombreNormalizado = normalizeToolText(nombreProyecto || '');

    for (const proyecto of proyectosActivos) {
        const proyectoNormalizado = normalizeToolText(proyecto.nombre);
        if (!proyectoNormalizado) {
            continue;
        }

        if (nombreNormalizado && (
            proyectoNormalizado.includes(nombreNormalizado) ||
            nombreNormalizado.includes(proyectoNormalizado)
        )) {
            proyectos.set(proyecto.id, proyecto);
        }

        if (textoNormalizado.includes(proyectoNormalizado)) {
            proyectos.set(proyecto.id, proyecto);
        }
    }

    for (const index of extraerIndicesProyecto(textoNormalizado, proyectosActivos.length)) {
        const proyecto = proyectosActivos[index];
        if (proyecto) {
            proyectos.set(proyecto.id, proyecto);
        }
    }

    return Array.from(proyectos.values());
}

export function isFaqMultiProjectQuery(textoNormalizado: string, totalProyectos: number): boolean {
    const mencionaCantidadDinamica = [
        /\blos\s+(\d{1,2})\s+proyectos?\b/i,
        /\btodos?\s+los\s+proyectos?\b/i,
    ].some((pattern) => pattern.test(textoNormalizado));

    const palabrasCantidad = ['dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];
    const mencionaCantidadEnTexto = palabrasCantidad.some((palabra) =>
        new RegExp(`\\blos\\s+${palabra}\\s+proyectos?\\b`, 'i').test(textoNormalizado)
    );

    if (mencionaCantidadDinamica || mencionaCantidadEnTexto) {
        return totalProyectos > 1;
    }

    const patrones = [
        /\bcompar/i,
        /\bdiferenc/i,
        /\botros?\s+proyectos?\b/i,
        /\bdemas\s+proyectos?\b/i,
        /\bentre\s+(?:los\s+)?proyectos?\b/i,
        /\bvarios\s+proyectos?\b/i,
    ];

    return patrones.some(pattern => pattern.test(textoNormalizado));
}

export function buildFaqContext(resultados: FaqDocumentResult[]): string {
    return resultados.map(({ document, score, proyectoId, nombreProyecto, collectionName }) => {
        const meta = document.metadata || {};
        const content = document.pageContent || '';

        if (meta.pregunta && meta.respuesta) {
            return [
                `PROYECTO: ${nombreProyecto} (ID ${proyectoId})`,
                `COLECCION: ${collectionName}`,
                `SCORE: ${score.toFixed(4)}`,
                'PREGUNTA FRECUENTE (Oficial):',
                `P: ${meta.pregunta}`,
                `R: ${meta.respuesta}`
            ].join('\n');
        }

        const matchPregunta = content.match(/Pregunta:\s*(.+?)(?:\n|$)/i);
        const matchRespuesta = content.match(/Respuesta:\s*(.+?)(?:\n|$)/i);
        if (matchPregunta && matchRespuesta) {
            return [
                `PROYECTO: ${nombreProyecto} (ID ${proyectoId})`,
                `COLECCION: ${collectionName}`,
                `SCORE: ${score.toFixed(4)}`,
                'PREGUNTA FRECUENTE (Oficial):',
                `P: ${matchPregunta[1].trim()}`,
                `R: ${matchRespuesta[1].trim()}`
            ].join('\n');
        }

        const fallback = meta.content || meta.text || content || '';
        return [
            `PROYECTO: ${nombreProyecto} (ID ${proyectoId})`,
            `COLECCION: ${collectionName}`,
            `SCORE: ${score.toFixed(4)}`,
            fallback
        ].join('\n');
    }).filter(Boolean).join('\n\n---\n\n');
}
