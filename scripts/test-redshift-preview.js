
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

/**
 * SCRIPT DE PRUEBA — Solo lectura de Redshift, NO inserta nada en MySQL.
 * Muestra las primeras filas traídas del warehouse para verificar la conexión y estructura.
 *
 * Uso:
 *   node scripts/test-redshift-preview.js
 *   node scripts/test-redshift-preview.js --limit=20   (default: 5)
 */

const REDSHIFT_URL =
    process.env.REDSHIFT_URL ||
    process.env.CHECOR_WAREHOUSE_URL ||
    process.env.WAREHOUSE_URL;

const REDSHIFT_SCHEMA = process.env.REDSHIFT_SCHEMA || process.env.CHECOR_WAREHOUSE_SCHEMA || 'checor';

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 5;

async function main() {
    if (!REDSHIFT_URL) {
        console.error('[ERROR] No se encontró REDSHIFT_URL / CHECOR_WAREHOUSE_URL en el .env');
        process.exit(1);
    }

    let pg;
    try {
        pg = require('pg');
    } catch {
        console.error('[ERROR] Falta la dependencia "pg". Ejecuta: npm install pg');
        process.exit(1);
    }

    const { Client } = pg;
    const client = new Client({
        connectionString: REDSHIFT_URL,
        ssl: { rejectUnauthorized: false },
    });

    console.log(`\n[redshift] Conectando a: ${REDSHIFT_URL.replace(/:([^:@]+)@/, ':***@')}`);
    console.log(`[redshift] Schema: ${REDSHIFT_SCHEMA}`);

    try {
        await client.connect();
        console.log('[redshift] ✅ Conexión exitosa\n');

        // 1. Ver qué tablas hay en el schema
        const tablesResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = $1
            ORDER BY table_name
        `, [REDSHIFT_SCHEMA]);

        console.log(`[info] Tablas encontradas en schema "${REDSHIFT_SCHEMA}":`);
        if (tablesResult.rows.length === 0) {
            console.log('  (ninguna)');
        } else {
            tablesResult.rows.forEach((r) => console.log(`  - ${r.table_name}`));
        }

        // 2. Buscar tabla de inventario — priorizar "unidades", luego variantes
        const inventoryTable =
            tablesResult.rows.find((r) => r.table_name === 'unidades') ||
            tablesResult.rows.find((r) => /unidad|inventar|departament|inmueble|stock/i.test(r.table_name));

        if (!inventoryTable) {
            console.log('\n[aviso] No se encontró una tabla de inventario obvia.');
            console.log('Mostrando las primeras filas de la primera tabla disponible...\n');
        }

        const targetTable = inventoryTable?.table_name || tablesResult.rows[0]?.table_name;

        if (!targetTable) {
            console.log('[aviso] No hay tablas disponibles. Verifica el schema y permisos.');
            return;
        }

        console.log(`\n[preview] Tabla seleccionada para preview: "${REDSHIFT_SCHEMA}.${targetTable}"`);

        // 3. Ver columnas de esa tabla
        const columnsResult = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
        `, [REDSHIFT_SCHEMA, targetTable]);

        console.log(`\n[columnas] Columnas de "${targetTable}" (${columnsResult.rows.length} total):`);
        columnsResult.rows.forEach((c) => console.log(`  ${c.column_name} (${c.data_type})`));

        // 4. Traer muestra de filas
        const previewResult = await client.query(
            `SELECT * FROM ${REDSHIFT_SCHEMA}.${targetTable} LIMIT $1`,
            [LIMIT]
        );

        console.log(`\n[preview] Primeras ${previewResult.rows.length} filas de "${targetTable}":\n`);
        previewResult.rows.forEach((row, i) => {
            console.log(`--- Fila ${i + 1} ---`);
            Object.entries(row).forEach(([k, v]) => {
                console.log(`  ${k}: ${v}`);
            });
            console.log('');
        });

        console.log(`[done] Preview completado. NO se insertó nada en MySQL.`);
    } finally {
        await client.end().catch(() => undefined);
    }
}

main().catch((err) => {
    console.error(`[ERROR] ${err?.message || err}`);
    process.exit(1);
});
