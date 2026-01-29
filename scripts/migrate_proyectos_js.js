
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_CONFIG = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASS, 
    database: process.env.DB_NAME,
};

async function migrate() {
    let connection;
    try {
        connection = await mysql.createConnection(DB_CONFIG);
        console.log('Conectado a la base de datos');

        // 1. Leer el archivo JSON
        const jsonPath = path.join(__dirname, 'proyectos.json');
        if (!fs.existsSync(jsonPath)) {
            throw new Error(`Archivo no encontrado: ${jsonPath}`);
        }
        const fileContent = fs.readFileSync(jsonPath, 'utf-8');
        const data = JSON.parse(fileContent);
        const unidades = data.proyectos;

        console.log(`Encontradas ${unidades.length} unidades para procesar`);

        // 2. Obtener ID del proyecto "Los Lirios"
        const [rows] = await connection.execute(
            'SELECT id FROM tbl_proyectos WHERE nombre LIKE ? LIMIT 1',
            ['%Los Lirios%']
        );

        let projectId;

        if (rows.length > 0) {
            projectId = rows[0].id;
            console.log(`ℹ️ Proyecto "Los Lirios" encontrado con ID: ${projectId}`);
        } else {
            console.log('⚠️ Proyecto "Los Lirios" no encontrado. Creándolo...');
            const [result] = await connection.execute(
                'INSERT INTO tbl_proyectos (codigo_empresa, nombre, tipo_inmueble) VALUES (1, "Los Lirios", "Multifamiliar")'
            );
            projectId = result.insertId;
            console.log(` Proyecto creado con ID: ${projectId}`);
        }

        // 3. Insertar unidades
        let insertedCount = 0;

        // Preparar query
        const query = `
        INSERT INTO tbl_unidades_proyectos (
            id_proyecto, unidad, tipo_unidad, tipologia, 
            nro_piso, nro_dormitorios, vista, 
            area_total, area_techada, area_libre, 
            precio_lista, moneda_lista, precio_promocion, fecha_fin_promocion,
            disponibilidad, url_plano, url_ubicacion, url_plano_2,
            features_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
            precio_lista = VALUES(precio_lista),
            precio_promocion = VALUES(precio_promocion),
            disponibilidad = VALUES(disponibilidad),
            updated_at = NOW();
    `;

        for (const item of unidades) {
            // Limpieza de datos
            const bedroomsMatch = String(item['Nro de Dormitorios']).match(/(\d+)/);
            const bedrooms = bedroomsMatch ? parseInt(bedroomsMatch[0]) : null;

            const areaTotalMatch = String(item['Area Total']).replace(' m2', '').trim();
            const areaTotal = parseFloat(areaTotalMatch) || 0;

            const areaTechada = item['Area Techada'] ? parseFloat(String(item['Area Techada']).replace(' m2', '')) : null;
            const areaLibre = item['Area Libre'] ? parseFloat(String(item['Area Libre']).replace(' m2', '')) : null;

            // Features extras en JSON
            const extraFeatures = {
                beneficios: [
                    item['Beneficio 1'],
                    item['Beneficio 2'],
                    item['Beneficio 3'],
                    item['Beneficio 4']
                ].filter(b => b && b !== '-'),
                caracteristicas: [
                    item['Característica 2'],
                    item['Característica 3'],
                    item['Característica 4']
                ].filter(c => c && c !== '-'),
                mensaje_urgencia: item['Mensaje para generar urgencia'] !== '-' ? item['Mensaje para generar urgencia'] : null
            };

            const values = [
                projectId,
                item['Nro de Unidad'],
                item['Tipo de Inmueble'],
                item['Tipología'],
                item['Nro de Piso'],
                bedrooms,
                String(item['Vista']).toLowerCase(),
                areaTotal,
                areaTechada,
                areaLibre,
                item['Precio de Lista'],
                item['Moneda de Lista'],
                item['Precio promocional o promoción del mes'],
                item['Tiempo de la promoción'],
                item['Disponibilidad'],
                item['Enlace Plano'],
                item['Enlace de ubicación'],
                item['Enlace Plano 2'] || null,
                JSON.stringify(extraFeatures)
            ];

            await connection.execute(query, values);
            insertedCount++;
        }

        console.log(`✅ Migración completada: ${insertedCount} unidades procesadas.`);

    } catch (error) {
        console.error('Error en la migración:', error);
    } finally {
        if (connection) await connection.end();
    }
}

migrate();
