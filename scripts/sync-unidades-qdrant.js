/**
 * Script para sincronizar unidades de tbl_unidades_proyectos a Qdrant
 * Lee las colecciones de tbl_colecciones_qdrant
 *
 * Uso: node scripts/sync-unidades-qdrant.js
 *
 * Requiere: .env con QDRANT_URL, OPENAI_API_KEY, DB_*
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { QdrantVectorStore } = require('@langchain/qdrant');
const { Document } = require('@langchain/core/documents');

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'checor',
};

const QDRANT_URL = process.env.QDRANT_URL || 'http://161.132.48.32:6440';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';
const VECTOR_SIZE = 1536;
const BATCH_SIZE = 10;

function construirTextoEmbedding(unidad, nombreProyecto) {
    const partes = [];
    partes.push(`Project ${nombreProyecto}`);
    partes.push(`Unit ${unidad.unidad}`);
    partes.push(`Type: ${unidad.tipo_unidad}`);
    if (unidad.tipologia) partes.push(`Typology: ${unidad.tipologia}`);
    partes.push(`Floor ${unidad.nro_piso}`);

    const dorm = unidad.nro_dormitorios;
    if (dorm === 0) {
        partes.push('Studio apartment');
    } else {
        partes.push(`${dorm} bedroom${dorm > 1 ? 's' : ''}`);
    }

    if (unidad.vista) partes.push(`View ${unidad.vista}`);
    if (unidad.area_total) partes.push(`Total area ${unidad.area_total} m2`);
    if (unidad.area_techada) partes.push(`Built area ${unidad.area_techada} m2`);
    if (unidad.area_libre) partes.push(`Free area ${unidad.area_libre} m2`);
    if (unidad.precio_lista) partes.push(`List price ${unidad.precio_lista} ${unidad.moneda_lista}`);
    if (unidad.precio_promocion) partes.push(`Promotional price ${unidad.precio_promocion} ${unidad.moneda_lista}`);
    partes.push(`Available: ${unidad.disponibilidad}`);

    const features = unidad.features_json;
    if (features) {
        const f = typeof features === 'string' ? JSON.parse(features) : features;
        if (f.direccion) partes.push(`Address: ${f.direccion}`);
        if (f.distrito) partes.push(`District: ${f.distrito}`);
        if (f.beneficios && f.beneficios.length > 0) partes.push(`Benefits: ${f.beneficios.join(', ')}`);
        if (f.caracteristicas && f.caracteristicas.length > 0) partes.push(`Features: ${f.caracteristicas.join(', ')}`);
        if (f.mensaje_urgencia) partes.push(`Urgency: ${f.mensaje_urgencia}`);
    }

    return partes.join('. ');
}

function construirPayload(unidad, nombreProyecto) {
    const features = unidad.features_json;
    const f = features ? (typeof features === 'string' ? JSON.parse(features) : features) : {};

    return {
        project: nombreProyecto,
        unit_number: unidad.unidad,
        unit_type: unidad.tipo_unidad,
        typology: unidad.tipologia || '',
        floor: unidad.nro_piso,
        bedrooms: unidad.nro_dormitorios,
        view: (unidad.vista || '').toLowerCase(),
        area_total: parseFloat(unidad.area_total) || 0,
        area_built: parseFloat(unidad.area_techada) || 0,
        area_free: parseFloat(unidad.area_libre) || 0,
        price_list: parseFloat(unidad.precio_lista) || 0,
        currency: unidad.moneda_lista || 'soles',
        price_promo: parseFloat(unidad.precio_promocion) || 0,
        promo_end_date: unidad.fecha_fin_promocion || '',
        availability: unidad.disponibilidad || 'Sí',
        url_floor_plan: unidad.url_plano || '',
        url_location: unidad.url_ubicacion || '',
        address: f.direccion || '',
        district: f.distrito || '',
        benefits: f.beneficios || [],
        features: f.caracteristicas || [],
        urgency_message: f.mensaje_urgencia || '',
    };
}

async function main() {
    const connection = await mysql.createConnection(DB_CONFIG);
    console.log('Conectado a la base de datos');

    const qdrantClient = new QdrantClient({
        url: QDRANT_URL,
        apiKey: QDRANT_API_KEY || undefined,
    });

    const embeddings = new OpenAIEmbeddings({
        modelName: 'text-embedding-3-small',
        openAIApiKey: process.env.OPENAI_API_KEY,
    });

    // Obtener colecciones de inventario
    const [colecciones] = await connection.execute(
        "SELECT c.*, p.nombre as nombre_proyecto FROM tbl_colecciones_qdrant c JOIN tbl_proyectos p ON c.id_proyecto = p.id WHERE c.tipo_coleccion = 'inventario' AND c.estado = 'activo'"
    );

    console.log(`\nColecciones de inventario encontradas: ${colecciones.length}`);

    for (const col of colecciones) {
        const collectionName = col.nombre_coleccion;
        const idProyecto = col.id_proyecto;
        const nombreProyecto = col.nombre_proyecto;

        console.log(`\n--- Procesando: ${collectionName} (${nombreProyecto}, id=${idProyecto}) ---`);

        // Obtener unidades del proyecto
        const [unidades] = await connection.execute(
            'SELECT * FROM tbl_unidades_proyectos WHERE id_proyecto = ? ORDER BY nro_piso, unidad',
            [idProyecto]
        );

        if (unidades.length === 0) {
            console.log('  Sin unidades, saltando');
            continue;
        }

        console.log(`  ${unidades.length} unidades encontradas`);

        // Recrear coleccion
        try {
            await qdrantClient.deleteCollection(collectionName);
            console.log(`  Coleccion ${collectionName} eliminada`);
        } catch (e) {
            console.log(`  Coleccion ${collectionName} no existia`);
        }

        await qdrantClient.createCollection(collectionName, {
            vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
        });
        console.log(`  Coleccion ${collectionName} creada`);

        // Crear VectorStore
        const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
            url: QDRANT_URL,
            apiKey: QDRANT_API_KEY || undefined,
            collectionName: collectionName,
        });

        // Subir en lotes
        let subidos = 0;
        for (let i = 0; i < unidades.length; i += BATCH_SIZE) {
            const lote = unidades.slice(i, i + BATCH_SIZE);
            const documents = lote.map(u => {
                const texto = construirTextoEmbedding(u, nombreProyecto);
                const metadata = construirPayload(u, nombreProyecto);
                return new Document({ pageContent: texto, metadata });
            });

            await vectorStore.addDocuments(documents);
            subidos += documents.length;
            console.log(`  Subidos ${subidos}/${unidades.length}`);
        }

        console.log(`  Completado: ${subidos} unidades en ${collectionName}`);
    }

    await connection.end();
    console.log('\nSincronizacion completada');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
