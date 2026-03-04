/**
 * Script para insertar unidades del JSON en tbl_unidades_proyectos
 * y luego sincronizar a Qdrant
 *
 * Uso: node scripts/insertar-unidades-json.js
 *
 * Requiere: .env con variables de DB y Qdrant
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'checor',
};

const PROYECTO_MAP = {
    lirios: 1,
    cerezos: 2,
    porta_360: 3,
};

function parsearDormitorios(valor) {
    if (!valor) return 0;
    const str = String(valor).toLowerCase();
    if (str.includes('monoambiente') || str.includes('mono')) return 0;
    const match = str.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

function parsearArea(valor) {
    if (!valor) return null;
    const str = String(valor).replace(/\s*m2\s*/gi, '').replace(',', '.').trim();
    const num = parseFloat(str);
    return isNaN(num) ? null : num;
}

function parsearPrecio(valor) {
    if (!valor || valor === '-') return null;
    const num = parseFloat(String(valor).replace(/[^0-9.]/g, ''));
    return isNaN(num) ? null : num;
}

async function main() {
    const jsonPath = path.join(__dirname, 'lusta_checor_prod.json');
    if (!fs.existsSync(jsonPath)) {
        console.error('No se encontro lusta_checor_prod.json en /scripts');
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const connection = await mysql.createConnection(DB_CONFIG);
    console.log('Conectado a la base de datos');

    let totalInsertados = 0;

    for (const [key, idProyecto] of Object.entries(PROYECTO_MAP)) {
        const unidades = data[key];
        if (!unidades || unidades.length === 0) {
            console.log(`No hay unidades para ${key}`);
            continue;
        }

        console.log(`\nProcesando ${key}: ${unidades.length} unidades (id_proyecto=${idProyecto})`);

        // Limpiar unidades existentes de este proyecto
        await connection.execute('DELETE FROM tbl_unidades_proyectos WHERE id_proyecto = ?', [idProyecto]);
        console.log(`  Unidades anteriores eliminadas`);

        for (const u of unidades) {
            const tipoUnidad = u['Tipo de Inmueble'] || 'Flat';
            const tipologia = u['Tipología'] || '';
            const nroPiso = u['Nro de Piso'] || 0;
            const dormitorios = parsearDormitorios(u['Nro de Dormitorios']);
            const vista = u['Vista'] || '';
            const areaTotal = parsearArea(u['Area Total']);
            const areaTechada = parsearArea(u['Area Techada']);
            const areaLibre = parsearArea(u['Area Libre']);
            const precioLista = parsearPrecio(u['Precio de Lista']);
            const moneda = (u['Moneda de Lista'] || 'soles').trim().toLowerCase();
            const precioPromo = parsearPrecio(u['Precio promocional o promoción del mes']);
            const fechaPromo = u['Tiempo de la promoción'] || null;
            const disponibilidad = u['Disponibilidad'] || 'Sí';
            const urlPlano = u['Enlace Plano'] || null;
            const urlUbicacion = u['Enlace de ubicación'] || null;

            const featuresJson = {};
            if (u['Dirección']) featuresJson.direccion = u['Dirección'];
            if (u['Departamento']) featuresJson.departamento = u['Departamento'];
            if (u['Distrito']) featuresJson.distrito = u['Distrito'];

            await connection.execute(
                `INSERT INTO tbl_unidades_proyectos 
                (id_proyecto, unidad, tipo_unidad, tipologia, nro_piso, nro_dormitorios, vista, 
                 area_total, area_techada, area_libre, precio_lista, moneda_lista, 
                 precio_promocion, fecha_fin_promocion, disponibilidad, 
                 url_plano, url_ubicacion, features_json) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    idProyecto,
                    u['Nro de Unidad'],
                    tipoUnidad,
                    tipologia,
                    nroPiso,
                    dormitorios,
                    vista,
                    areaTotal,
                    areaTechada,
                    areaLibre,
                    precioLista,
                    moneda,
                    precioPromo,
                    fechaPromo,
                    disponibilidad,
                    urlPlano,
                    urlUbicacion,
                    JSON.stringify(featuresJson),
                ]
            );
            totalInsertados++;
        }
        console.log(`  ${unidades.length} unidades insertadas`);
    }

    console.log(`\nTotal insertados: ${totalInsertados} unidades`);
    await connection.end();
    console.log('Conexion cerrada');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
