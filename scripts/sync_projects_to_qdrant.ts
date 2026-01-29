
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { QdrantVectorService } from '../src/modules/ia/qdrant-vector.service';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { ConfigService } from '@nestjs/config';
import { PropertyEmbeddingStrategy, PropertyUnit } from '../src/modules/ia/strategies/property-embedding.strategy';

require('mysql2');

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const logger = new Logger('SyncProjectsToQdrant');

    try {
        const qdrantService = app.get(QdrantVectorService);
        const dataSource = app.get(DataSource);
        const configService = app.get(ConfigService);
        const embeddingStrategy = new PropertyEmbeddingStrategy();

        const collectionName = configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'propiedades-los-lirios';

        logger.log(`Starting sync to Qdrant collection: ${collectionName}`);

        const query = `
      SELECT 
        u.id,
        u.id_proyecto,
        u.unidad,
        u.tipo_unidad,
        u.tipologia,
        u.nro_piso,
        u.nro_dormitorios,
        u.vista,
        u.area_total,
        u.area_techada,
        u.area_libre,
        u.precio_lista,
        u.moneda_lista,
        u.precio_promocion,
        u.fecha_fin_promocion,
        u.disponibilidad,
        u.url_plano,
        u.url_ubicacion,
        u.url_plano_2,
        u.features_json,
        p.nombre as nombre_proyecto,
        p.tipo_inmueble as proyecto_tipo_inmueble,
        p.ubicacion as proyecto_ubicacion
      FROM tbl_unidades_proyectos u
      JOIN tbl_proyectos p ON u.id_proyecto = p.id
      WHERE u.disponibilidad IS NOT NULL
    `;

        const units: PropertyUnit[] = await dataSource.query(query);
        logger.log(`Found ${units.length} units in MySQL`);

        if (units.length === 0) {
            logger.warn('No units found to sync');
            return;
        }

        const documents: Document[] = units.map((unit) => {
            const doc = embeddingStrategy.generateDocumentForProperty(unit);
            return new Document({
                pageContent: doc.pageContent,
                metadata: doc.metadata,
            });
        });

        logger.log(`Generated ${documents.length} documents for embedding`);

        try {
            await qdrantService.recreateCollection(collectionName);
            logger.log('Collection recreated successfully');
        } catch (e) {
            logger.error(`Error recreating collection: ${e.message}`);
        }

        await qdrantService.addDocuments(collectionName, documents);

        logger.log(`Successfully synced ${documents.length} documents to Qdrant`);
        logger.log('Sample document:');
        logger.log(`PageContent: ${documents[0].pageContent}`);
        logger.log('Metadata:');
        logger.log(JSON.stringify(documents[0].metadata, null, 2));

    } catch (error) {
        logger.error(`Sync failed: ${error.message}`, error.stack);
    } finally {
        await app.close();
        process.exit(0);
    }
}

bootstrap();
