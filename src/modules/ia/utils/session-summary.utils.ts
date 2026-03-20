export interface SessionSummaryContext {
    dormitorios?: string;
    proposito?: string;
    zonaPreferida?: string;
    tiempoCompra?: string;
    financiamiento?: string;
    presupuesto?: string;
    nombreCompleto?: string;
    dni?: string;
    email?: string;
    ocupacion?: string;
    ingresos?: string;
    unidadInteres?: string;
    tieneProforma: boolean;
    notasAdicionales: string[];
    pasoPendiente: number;
}

interface ExtractedLine {
    value: string;
    line: string;
}

function normalizeValue(value?: string): string | undefined {
    if (!value) return undefined;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : undefined;
}

function extractFirst(lines: string[], patterns: RegExp[], matched: Set<string>): ExtractedLine | undefined {
    for (const line of lines) {
        for (const pattern of patterns) {
            const match = line.match(pattern);
            const captured = normalizeValue(match?.[1]);
            if (captured) {
                matched.add(line);
                return { value: captured, line };
            }
        }
    }
    return undefined;
}

function detectBoolean(lines: string[], patterns: RegExp[], matched: Set<string>): boolean {
    for (const line of lines) {
        if (patterns.some((pattern) => pattern.test(line))) {
            matched.add(line);
            return true;
        }
    }
    return false;
}

export function inferPasoPendienteFromSummary(context: Omit<SessionSummaryContext, 'pasoPendiente' | 'notasAdicionales'>): number {
    if (!context.dormitorios) return 1;
    if (!context.proposito || !context.zonaPreferida) return 2;
    if (!context.tiempoCompra) return 3;
    // Si ya tiene presupuesto, avanzar a paso 6 aunque falte financiamiento.
    // El cliente puede responder de formas ambiguas ("con ustedes", "así nomás")
    // y no debemos bloquear la búsqueda por eso.
    if (!context.presupuesto && !context.financiamiento) return 4;
    if (!context.presupuesto) return 5;

    const tieneUnidadSeleccionada = !!context.unidadInteres;

    if (!tieneUnidadSeleccionada && !context.tieneProforma && !context.ocupacion && !context.ingresos) {
        return 6;
    }

    if (!context.nombreCompleto || !context.dni) {
        return 8;
    }

    if (!context.ocupacion || !context.ingresos || !context.tieneProforma) {
        return 9;
    }

    return 11;
}

export function parseSessionSummary(summary?: string): SessionSummaryContext {
    const lines = (summary || '')
        .split('\n')
        .map((line) => line.replace(/^•\s*/, '').trim())
        .filter(Boolean);

    const matched = new Set<string>();

    const dormitorios = extractFirst(lines, [
        /Paso 1 - Dormitorios:\s*(.+)$/i,
        /Busca depa de\s+(.+)$/i,
    ], matched)?.value;

    const proposito = extractFirst(lines, [
        /Paso 2 - Proposito:\s*(.+)$/i,
        /Prop[oó]sito:\s*(.+)$/i,
    ], matched)?.value;

    const zonaPreferida = extractFirst(lines, [
        /Paso 2 - Zona preferida:\s*(.+)$/i,
        /Zona preferida:\s*(.+)$/i,
    ], matched)?.value;

    const tiempoCompra = extractFirst(lines, [
        /Paso 3 - Tiempo de compra:\s*(.+)$/i,
        /Tiempo de compra:\s*(.+)$/i,
    ], matched)?.value;

    const financiamiento = extractFirst(lines, [
        /Paso 4 - Financiamiento:\s*(.+)$/i,
        /Financiamiento:\s*(.+)$/i,
    ], matched)?.value;

    const presupuesto = extractFirst(lines, [
        /Paso 5 - Presupuesto\/Cuota:\s*(.+)$/i,
        /Presupuesto\/Cuota:\s*(.+)$/i,
        /Presupuesto maximo:\s*(.+)$/i,
    ], matched)?.value;

    const unidadInteres = extractFirst(lines, [
        /Paso 6 - Unidad de interes:\s*(.+)$/i,
        /Interesado en unidad\s+(.+)$/i,
        /Cotiz[oó]\s+unidad\s+([A-Za-z0-9-]+)/i,
    ], matched)?.value;

    const nombreCompleto = extractFirst(lines, [
        /Paso 8 - Nombre completo:\s*(.+)$/i,
        /Identificado:\s*(.+)$/i,
    ], matched)?.value;

    const dni = extractFirst(lines, [
        /Paso 8 - DNI:\s*(\d{8})$/i,
        /DNI capturado:\s*(\d{8})$/i,
    ], matched)?.value;

    const ocupacion = extractFirst(lines, [
        /Paso 9 - Ocupaci[oó]n:\s*(.+)$/i,
        /Ocupaci[oó]n:\s*(.+)$/i,
    ], matched)?.value;

    const ingresos = extractFirst(lines, [
        /Paso 9 - Ingresos mensuales:\s*(.+)$/i,
        /Ingresos mensuales:\s*(.+)$/i,
    ], matched)?.value;

    const email = extractFirst(lines, [
        /Paso 11 - Email:\s*(.+)$/i,
        /Email registrado:\s*(.+)$/i,
    ], matched)?.value;

    const tieneProforma = detectBoolean(lines, [
        /Paso 9 - Proforma generada/i,
        /Cotiz[oó]\s+unidad/i,
        /proforma/i,
        /cotiz/i,
    ], matched);

    const notasAdicionales = lines.filter((line) => !matched.has(line));

    const pasoPendiente = inferPasoPendienteFromSummary({
        dormitorios,
        proposito,
        zonaPreferida,
        tiempoCompra,
        financiamiento,
        presupuesto,
        nombreCompleto,
        dni,
        email,
        ocupacion,
        ingresos,
        unidadInteres,
        tieneProforma,
    });

    return {
        dormitorios,
        proposito,
        zonaPreferida,
        tiempoCompra,
        financiamiento,
        presupuesto,
        nombreCompleto,
        dni,
        email,
        ocupacion,
        ingresos,
        unidadInteres,
        tieneProforma,
        notasAdicionales,
        pasoPendiente,
    };
}
