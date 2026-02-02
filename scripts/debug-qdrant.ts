/**
 * Debug Qdrant collection schema and payloads
 * Run with: npx ts-node scripts/debug-qdrant.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';

async function debug() {
    console.log('=== QDRANT DEBUG ===\n');

    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error'],
    });

    const configService = app.get(ConfigService);
    const collectionName = configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'checor-projects-v1';
    const qdrantUrl = configService.get<string>('QDRANT_URL');
    const qdrantApiKey = configService.get<string>('QDRANT_API_KEY');

    console.log(`Collection: ${collectionName}`);
    console.log(`URL: ${qdrantUrl}\n`);

    const client = new QdrantClient({ url: qdrantUrl, apiKey: qdrantApiKey });

    // 1. Get collection info
    try {
        const info = await client.getCollection(collectionName);
        console.log('Collection Info:', JSON.stringify(info, null, 2));
    } catch (e) {
        console.log('Error getting collection:', e.message);
    }

    // 2. Scroll to get sample documents without filter
    console.log('\n=== SAMPLE DOCUMENTS (no filter) ===');
    try {
        const scrollResult = await client.scroll(collectionName, {
            limit: 3,
            with_payload: true,
            with_vector: false
        });

        if (scrollResult.points.length > 0) {
            console.log(`Found ${scrollResult.points.length} documents\n`);
            scrollResult.points.forEach((point, i) => {
                console.log(`--- Document ${i + 1} ---`);
                console.log('ID:', point.id);
                if (point.payload) {
                    console.log('Payload keys:', Object.keys(point.payload));
                    // Check if metadata is nested
                    if ((point.payload as any).metadata) {
                        console.log('metadata.typology:', (point.payload as any).metadata.typology);
                    } else {
                        console.log('typology (direct):', (point.payload as any).typology);
                    }
                }
                console.log('');
            });
        }
    } catch (e) {
        console.log('Error scrolling:', e.message);
    }

    // 3. Try different filter approaches
    console.log('\n=== TESTING FILTERS ===');

    // Test 1: metadata.typology
    try {
        const result1 = await client.scroll(collectionName, {
            limit: 5,
            with_payload: true,
            filter: {
                must: [{ key: 'metadata.typology', match: { value: 'Tipo 3' } }]
            }
        });
        console.log('Filter "metadata.typology" matched:', result1.points.length, 'documents');
    } catch (e) {
        console.log('Error with metadata.typology filter:', e.message);
    }

    // Test 2: typology (direct)
    try {
        const result2 = await client.scroll(collectionName, {
            limit: 5,
            with_payload: true,
            filter: {
                must: [{ key: 'typology', match: { value: 'Tipo 3' } }]
            }
        });
        console.log('Filter "typology" matched:', result2.points.length, 'documents');
    } catch (e) {
        console.log('Error with typology filter:', e.message);
    }

    // Test 2.5: Tipo 5 specifically
    try {
        const result25 = await client.scroll(collectionName, {
            limit: 10,
            with_payload: true,
            filter: {
                must: [{ key: 'metadata.typology', match: { value: 'Tipo 5' } }]
            }
        });
        console.log('Filter "metadata.typology = Tipo 5" matched:', result25.points.length, 'documents');
        if (result25.points.length > 0) {
            console.log('Tipo 5 units:', result25.points.map((p: any) => p.payload.metadata.unit_number).join(', '));
        }
    } catch (e) {
        console.log('Error with Tipo 5 filter:', e.message);
    }

    // Test 3: payload.metadata.typology
    try {
        const result3 = await client.scroll(collectionName, {
            limit: 5,
            with_payload: true,
            filter: {
                must: [{ key: 'payload.metadata.typology', match: { value: 'Tipo 3' } }]
            }
        });
        console.log('Filter "payload.metadata.typology" matched:', result3.points.length, 'documents');
    } catch (e) {
        console.log('Error with payload.metadata.typology filter:', e.message);
    }

    await app.close();
    console.log('\n=== DEBUG COMPLETE ===');
}

debug()
    .then(() => process.exit(0))
    .catch(e => {
        console.error('Fatal:', e);
        process.exit(1);
    });
