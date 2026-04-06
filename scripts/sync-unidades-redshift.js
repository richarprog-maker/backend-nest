
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs');
const mysql = require('mysql2/promise');

const DEFAULT_PROJECTS = ['Los Lirios', 'Porta 360', 'Los Cerezos'];
const SQL_FILE_PATH = path.join(__dirname, 'sql', 'redshift-unidades-inventario.sql');

const MYSQL_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'checor',
};

function loadPgClient() {
    try {
        return require('pg');
    } catch (error) {
        throw new Error(
            'No se encontró la dependencia "pg". Instala el paquete con "npm install pg" dentro de backend-nest antes de ejecutar este script.',
        );
    }
}

function parseArgs(argv) {
    const options = {
        write: false,
        projects: [...DEFAULT_PROJECTS],
    };

    for (const rawArg of argv) {
        if (rawArg === '--write') {
            options.write = true;
            continue;
        }

        if (rawArg.startsWith('--project=')) {
            const value = rawArg.slice('--project='.length);
            const projects = value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);

            if (projects.length > 0) {
                options.projects = projects;
            }
        }
    }

    return options;
}

function normalizeText(value) {
    return String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function getRowValue(row, keys) {
    for (const key of keys) {
        if (row[key] !== null && row[key] !== undefined && row[key] !== '') {
            return row[key];
        }
    }

    return null;
}

function toTitleCase(value) {
    return String(value || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function validateSqlIdentifier(value, label) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
        throw new Error(`${label} inválido: ${value}`);
    }
}

function escapeSqlLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function renderWarehouseSql(schema, projects) {
    validateSqlIdentifier(schema, 'Schema de Redshift');

    if (!fs.existsSync(SQL_FILE_PATH)) {
        throw new Error(`No se encontró el archivo SQL: ${SQL_FILE_PATH}`);
    }

    const sqlTemplate = fs.readFileSync(SQL_FILE_PATH, 'utf8');
    const projectsClause = projects.map(escapeSqlLiteral).join(', ');

    if (!projectsClause) {
        throw new Error('Debes indicar al menos un proyecto para consultar en Redshift.');
    }

    return sqlTemplate
        .replaceAll('__SCHEMA__', schema)
        .replace('__PROJECT_NAMES__', projectsClause);
}

function parseNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    const raw = String(value).trim();
    if (!raw) {
        return null;
    }

    const cleaned = raw.replace(/[^\d,.-]/g, '');
    if (!cleaned) {
        return null;
    }

    let normalized = cleaned;
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');

    if (hasComma && hasDot) {
        if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
            normalized = normalized.replace(/\./g, '').replace(',', '.');
        } else {
            normalized = normalized.replace(/,/g, '');
        }
    } else if (hasComma) {
        normalized = normalized.replace(',', '.');
    }

    const parsed = parseFloat(normalized);
    return Number.isNaN(parsed) ? null : parsed;
}

function parseBedrooms(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? Math.trunc(value) : null;
    }

    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }

    if (normalized.includes('monoambiente') || normalized.includes('mono')) {
        return 0;
    }

    const match = normalized.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

function normalizeCurrency(value) {
    const normalized = normalizeText(value);

    if (!normalized) {
        return 'soles';
    }

    if (
        normalized.includes('usd') ||
        normalized.includes('dolar') ||
        normalized.includes('dolares') ||
        normalized === '$' ||
        normalized === 'us$'
    ) {
        return 'usd';
    }

    if (
        normalized.includes('sol') ||
        normalized.includes('pen') ||
        normalized === 's/' ||
        normalized === 's'
    ) {
        return 'soles';
    }

    return normalized;
}

function parsePromoPrice(value) {
    return parseNumber(value);
}

function normalizeAvailability(value) {
    const normalized = normalizeText(value);

    if (!normalized) {
        return 'Sí';
    }

    if (normalized === 'si' || normalized === 'sí' || normalized === 'disponible') {
        return 'Sí';
    }

    if (
        normalized.includes('vendido') ||
        normalized.includes('no disponible') ||
        normalized.includes('reservado') ||
        normalized.includes('separado')
    ) {
        return 'No';
    }

    return String(value || '').trim() || 'Sí';
}

function normalizeUnitType(value) {
    const normalized = normalizeText(value);

    if (!normalized) {
        return 'Flat';
    }

    if (normalized.includes('duplex') || normalized.includes('dúplex')) {
        return 'Dúplex';
    }

    if (normalized.includes('flat')) {
        return 'Flat';
    }

    if (normalized.includes('estacionamiento')) {
        return 'Estacionamiento';
    }

    if (normalized.includes('deposito') || normalized.includes('depósito')) {
        return 'Depósito';
    }

    const words = String(value).trim().split(/\s+/).filter(Boolean);
    return toTitleCase(words[words.length - 1] || value);
}

function normalizeUnitNumber(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return null;
    }

    const onlyDigits = raw.replace(/\D/g, '');
    return onlyDigits || raw;
}

function normalizeTypology(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    return raw.replace(/\s*-\s*$/, '').replace(/\s+/g, ' ').trim();
}

function buildFeatures(row) {
    const features = {};

    const projectCode = getRowValue(row, ['proyecto_codigo', 'codigo proyecto', 'codigo_proyecto']);
    const projectAddress = getRowValue(row, ['proyecto_direccion', 'direccion proyecto', 'direccion_proyecto']);
    const promoDiscount = getRowValue(row, ['descuento_promocional', 'descuento promocional']);
    const promoText = getRowValue(row, ['promocion_mes', 'precio promocional o promoción del mes', 'precio_promocional']);
    const planName = getRowValue(row, ['nombre_archivo', 'nombre archivo']);
    const planMontage = getRowValue(row, ['montaje_archivo', 'montaje archivo']);
    const proformaCode = getRowValue(row, ['codigo_proforma_archivo', 'codigo proforma archivo']);

    if (projectCode) features.codigo_proyecto_externo = projectCode;
    if (projectAddress) features.direccion = projectAddress;
    if (promoDiscount) features.descuento_promocional = promoDiscount;
    if (promoText) features.promocion_mes = promoText;
    if (planName) features.nombre_archivo_plano = planName;
    if (planMontage) features.montaje_archivo = planMontage;
    if (proformaCode) features.codigo_proforma_archivo = proformaCode;

    return Object.keys(features).length > 0 ? features : null;
}

function mapWarehouseRow(row, localProjectId) {
    const unitNumber = getRowValue(row, ['nro_unidad', 'nro de unidad', 'unidad']);
    const unitType = getRowValue(row, ['tipo_inmueble', 'tipo de inmueble', 'tipo_unidad']);
    const typology = getRowValue(row, ['tipologia', 'tipología']);
    const floor = getRowValue(row, ['nro_piso', 'nro de piso', 'piso']);
    const bedrooms = getRowValue(row, ['nro_dormitorios', 'nro de dormitorios', 'dormitorios']);
    const view = getRowValue(row, ['vista']);
    const areaTotal = getRowValue(row, ['area_total', 'area total']);
    const areaTechada = getRowValue(row, ['area_techada', 'area techada']);
    const areaLibre = getRowValue(row, ['area_libre', 'area libre']);
    const priceList = getRowValue(row, ['precio_lista', 'precio de lista']);
    const currency = getRowValue(row, ['moneda_lista', 'moneda de lista']);
    const promoPrice = getRowValue(row, ['promocion_mes', 'precio promocional o promoción del mes', 'precio_promocional']);
    const promoTime = getRowValue(row, ['tiempo_promocion', 'tiempo de la promoción']);
    const availability = getRowValue(row, ['disponibilidad']);
    const floorPlanUrl = getRowValue(row, ['enlace_plano', 'enlace plano', 'url_plano']);
    const locationUrl = getRowValue(row, ['url_ubicacion', 'enlace de ubicación', 'enlace ubicacion', 'url de ubicación', 'url de ubicacion']);
    const projectName = getRowValue(row, ['proyecto_nombre', 'proyecto']);

    return {
        idProyecto: localProjectId,
        unidad: normalizeUnitNumber(unitNumber),
        tipoUnidad: normalizeUnitType(unitType),
        tipologia: normalizeTypology(typology),
        nroPiso: parseNumber(floor) || 0,
        nroDormitorios: parseBedrooms(bedrooms) ?? 0,
        vista: view || '',
        areaTotal: parseNumber(areaTotal),
        areaTechada: parseNumber(areaTechada),
        areaLibre: parseNumber(areaLibre),
        precioLista: parseNumber(priceList),
        monedaLista: normalizeCurrency(currency),
        precioPromocion: parsePromoPrice(promoPrice),
        fechaFinPromocion: promoTime ? String(promoTime) : null,
        disponibilidad: normalizeAvailability(availability),
        urlPlano: floorPlanUrl || null,
        urlUbicacion: locationUrl || null,
        featuresJson: buildFeatures(row),
        nombreProyecto: projectName,
    };
}

function scoreRowCompleteness(row) {
    const keys = [
        'tipologia',
        'vista',
        'area_total',
        'area_techada',
        'area_libre',
        'precio_lista',
        'promocion_mes',
        'enlace_plano',
    ];

    return keys.reduce((score, key) => {
        const value = row[key];
        return value !== null && value !== undefined && value !== '' ? score + 1 : score;
    }, 0);
}

function dedupeWarehouseRows(rows) {
    const deduped = new Map();

    for (const row of rows) {
        const projectName = getRowValue(row, ['proyecto_nombre', 'proyecto']);
        const unitNumber = getRowValue(row, ['nro_unidad', 'nro de unidad', 'unidad']);
        const key = `${normalizeText(projectName)}::${normalizeText(normalizeUnitNumber(unitNumber))}`;
        const current = deduped.get(key);

        if (!current || scoreRowCompleteness(row) > scoreRowCompleteness(current)) {
            deduped.set(key, row);
        }
    }

    return Array.from(deduped.values());
}

async function loadLocalProjects(connection, projectNames) {
    const placeholders = projectNames.map(() => '?').join(', ');
    const [rows] = await connection.execute(
        `SELECT id, nombre FROM tbl_proyectos WHERE nombre IN (${placeholders})`,
        projectNames,
    );

    const map = new Map();
    for (const row of rows) {
        map.set(normalizeText(row.nombre), row);
    }

    return map;
}

function groupByProject(units) {
    const grouped = new Map();

    for (const unit of units) {
        if (!grouped.has(unit.idProyecto)) {
            grouped.set(unit.idProyecto, []);
        }
        grouped.get(unit.idProyecto).push(unit);
    }

    return grouped;
}

async function persistUnits(mysqlConnection, groupedUnits) {
    await mysqlConnection.beginTransaction();

    try {
        for (const [projectId, units] of groupedUnits.entries()) {
            await mysqlConnection.execute('DELETE FROM tbl_unidades_proyectos WHERE id_proyecto = ?', [projectId]);

            for (const unit of units) {
                await mysqlConnection.execute(
                    `INSERT INTO tbl_unidades_proyectos
                    (
                        id_proyecto,
                        unidad,
                        tipo_unidad,
                        tipologia,
                        nro_piso,
                        nro_dormitorios,
                        vista,
                        area_total,
                        area_techada,
                        area_libre,
                        precio_lista,
                        moneda_lista,
                        precio_promocion,
                        fecha_fin_promocion,
                        disponibilidad,
                        url_plano,
                        url_ubicacion,
                        features_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        unit.idProyecto,
                        unit.unidad,
                        unit.tipoUnidad,
                        unit.tipologia,
                        unit.nroPiso,
                        unit.nroDormitorios,
                        unit.vista,
                        unit.areaTotal,
                        unit.areaTechada,
                        unit.areaLibre,
                        unit.precioLista,
                        unit.monedaLista,
                        unit.precioPromocion,
                        unit.fechaFinPromocion,
                        unit.disponibilidad,
                        unit.urlPlano,
                        unit.urlUbicacion,
                        unit.featuresJson ? JSON.stringify(unit.featuresJson) : null,
                    ],
                );
            }
        }

        await mysqlConnection.commit();
    } catch (error) {
        await mysqlConnection.rollback();
        throw error;
    }
}

function printSummary(units) {
    const counters = new Map();

    for (const unit of units) {
        counters.set(unit.nombreProyecto, (counters.get(unit.nombreProyecto) || 0) + 1);
    }

    console.log('\nResumen de unidades preparadas:');
    for (const [projectName, total] of counters.entries()) {
        console.log(`- ${projectName}: ${total}`);
    }
    console.log(`- Total: ${units.length}`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const redshiftUrl = process.env.REDSHIFT_URL || process.env.CHECOR_WAREHOUSE_URL || process.env.WAREHOUSE_URL;
    const redshiftSchema = process.env.REDSHIFT_SCHEMA || process.env.CHECOR_WAREHOUSE_SCHEMA || 'checor';

    if (!redshiftUrl) {
        throw new Error(
            'Falta REDSHIFT_URL o CHECOR_WAREHOUSE_URL en el entorno. No se hardcodearon credenciales para evitar dejarlas en el repositorio.',
        );
    }

    const { Client } = loadPgClient();
    const warehouseSql = renderWarehouseSql(redshiftSchema, options.projects);

    const redshiftClient = new Client({
        connectionString: redshiftUrl,
        ssl: { rejectUnauthorized: false },
    });

    const mysqlConnection = await mysql.createConnection(MYSQL_CONFIG);

    try {
        await redshiftClient.connect();
        console.log(`[warehouse] Conectado a Redshift (${redshiftSchema})`);

        const result = await redshiftClient.query(warehouseSql);
        const dedupedRows = dedupeWarehouseRows(result.rows);
        console.log(`[warehouse] Filas recibidas: ${result.rows.length}`);
        console.log(`[warehouse] Filas deduplicadas por proyecto/unidad: ${dedupedRows.length}`);

        const localProjects = await loadLocalProjects(mysqlConnection, options.projects);
        const missingProjects = options.projects.filter((project) => !localProjects.has(normalizeText(project)));

        if (missingProjects.length > 0) {
            throw new Error(
                `No existen proyectos locales para: ${missingProjects.join(', ')}. Verifica tbl_proyectos antes de escribir unidades.`,
            );
        }

        const mappedUnits = dedupedRows
            .map((row) => {
                const projectName = getRowValue(row, ['proyecto_nombre', 'proyecto']);
                const rawUnitNumber = getRowValue(row, ['nro_unidad', 'nro de unidad', 'unidad']);
                const localProject = localProjects.get(normalizeText(projectName));
                if (!localProject) {
                    return null;
                }

                if (!normalizeUnitNumber(rawUnitNumber)) {
                    return null;
                }

                return mapWarehouseRow(row, localProject.id);
            })
            .filter(Boolean);

        printSummary(mappedUnits);

        if (!options.write) {
            console.log('\nModo preview: no se escribió nada en tbl_unidades_proyectos.');
            console.log('Cuando quieran activar la carga local usen: node scripts/sync-unidades-redshift.js --write');
            console.log('La sincronización hacia Qdrant sigue siendo un paso separado.');
            return;
        }

        const groupedUnits = groupByProject(mappedUnits);
        await persistUnits(mysqlConnection, groupedUnits);

        console.log('\nCarga local completada en tbl_unidades_proyectos.');
        console.log('No se ejecutó ninguna sincronización a Qdrant.');
    } finally {
        await mysqlConnection.end();
        await redshiftClient.end().catch(() => undefined);
    }
}

main().catch((error) => {
    const detail = error?.message || error?.stack || JSON.stringify(error);
    console.error(`Error en sincronización desde Redshift: ${detail}`);
    process.exit(1);
});
