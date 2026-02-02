/**
 * Test script for Qdrant property search
 * Run with: npx ts-node scripts/test-busqueda-qdrant.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ToolsExecutionService } from '../src/modules/ia/tools/tools-execution.service';
import { QdrantVectorService } from '../src/modules/ia/qdrant-vector.service';
import { ConfigService } from '@nestjs/config';

interface TestCase {
    name: string;
    params: Record<string, any>;
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('🔍 TEST: Búsqueda de Propiedades en Qdrant');
    console.log('='.repeat(60));

    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn', 'log'],
    });

    const toolsService = app.get(ToolsExecutionService);
    const qdrantService = app.get(QdrantVectorService);
    const configService = app.get(ConfigService);
    const collectionName = configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME') || 'checor-projects-v1';

    // RAW Qdrant test first
    console.log('\n=== RAW QDRANT TEST: Typology Filter ===');
    try {
        const rawResults = await qdrantService.searchPropertiesWithFilters(
            collectionName,
            'departamento',
            { tipologia: 'Tipo 3' },
            { limit: 5, threshold: 0.3 }
        );
        console.log(`Raw results for tipologia="Tipo 3": ${rawResults.length}`);
        if (rawResults.length > 0) {
            console.log('✅ Typology filter WORKS!');
            console.log('Sample:', rawResults[0].document.metadata.typology);
        } else {
            console.log('❌ NO RESULTS - Typology filter NOT working');
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    const testCases: TestCase[] = [
        { name: '1. Tipología 5 (existe - debe encontrar 6)', params: { tipologia: 'Tipo 5' } },
        { name: '2. Tipología 3 (existe)', params: { tipologia: 'Tipo 3' } },
        { name: '3. Vista exterior', params: { vista: 'exterior' } },
        { name: '4. 2 dormitorios', params: { dormitorios: 2 } },
        { name: '5. Tipo 3 + 2 dorm', params: { tipologia: 'Tipo 3', dormitorios: 2 } },
        { name: '6. Unidad 703', params: { unidad: '703' } },
        { name: '7. Tipología 9 (NO existe)', params: { tipologia: 'Tipo 9' } },
    ];

    for (const test of testCases) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📋 TEST: ${test.name}`);
        console.log(`   Params: ${JSON.stringify(test.params)}`);
        console.log('─'.repeat(60));

        try {
            const result = await toolsService.buscarDepartamentoUniversal(test.params);
            const maxLen = 1200;
            const displayResult = result.length > maxLen
                ? result.substring(0, maxLen) + '\n... [TRUNCADO]'
                : result;
            console.log(displayResult);

            if (result.includes('Encontré estas opciones exactas')) {
                console.log('\n✅ RESULTADO: EXACTO');
            } else if (result.includes('Aquí tienes las opciones')) {
                console.log('\n⚠️ RESULTADO: FALLBACK');
            } else if (result.includes('[ACCION_COMPLETADA]')) {
                console.log('\n✅ RESULTADO: OK');
            } else {
                console.log('\n❌ RESULTADO: Error');
            }
        } catch (error) {
            console.log(`❌ ERROR: ${error.message}`);
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('🏁 Tests completados');
    console.log('='.repeat(60));
    await app.close();
}

runTests()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Error fatal:', error);
        process.exit(1);
    });
