
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ProjectsSearchService } from '../src/modules/ia/projects-search.service';

// Force MySQL driver import
require('mysql2');

async function testRag() {
    const app = await NestFactory.createApplicationContext(AppModule);
    // Disable logging to keep output clean, or keep it to see debugs
    // app.useLogger(false); 

    try {
        const searchService = app.get(ProjectsSearchService);

        const query1 = "departamento de 2 dormitorios";
        console.log(`\n🔎 Testing Query 1: "${query1}"`);

        const result1 = await searchService.searchProperties(query1, 3, { leadUuid: 'test-lead', companyId: 1 });
        console.log('✅ Filters:', JSON.stringify(result1.filters_applied));
        console.log(`📊 Found ${result1.results.length} results`);
        result1.results.forEach(r => console.log(` - ${r.metadata.project_name} Unit ${r.metadata.unit_number}: ${r.metadata.price_promo} ${r.metadata.currency}`));


        const query2 = "algo de menos de 300000 soles";
        console.log(`\n🔎 Testing Query 2: "${query2}"`);
        const result2 = await searchService.searchProperties(query2, 3, { leadUuid: 'test-lead', companyId: 1 });
        console.log('✅ Filters:', JSON.stringify(result2.filters_applied));
        console.log(`📊 Found ${result2.results.length} results`);
        result2.results.forEach(r => console.log(` - ${r.metadata.project_name} Unit ${r.metadata.unit_number}: ${r.metadata.price_promo} ${r.metadata.currency}`));

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await app.close();
        process.exit(0);
    }
}

testRag();
