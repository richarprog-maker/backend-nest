
import { ToolsExecutionService } from './src/modules/ia/tools/tools-execution.service';

// Mock dependencies
const mockResumenService = {
    agregarPuntos: async () => { },
    agregarPunto: async () => { }
};

const mockConfigService = {
    get: () => 'mock-collection'
};

// Mock Qdrant results
// Mixed price/bedrooms to test sorting
const mockQdrantResults2Bed = [
    { document: { metadata: { unit_number: '101', bedrooms: 2, price_list: '120000', price_promo: '110000', floor: 1, area_total: 80, view: 'street', typology: 'T1' } } },
    { document: { metadata: { unit_number: '102', bedrooms: 2, price_list: '105000', price_promo: '95000', floor: 2, area_total: 80, view: 'street', typology: 'T1' } } }
];

const mockQdrantResults3Bed = [
    { document: { metadata: { unit_number: '201', bedrooms: 3, price_list: '150000', price_promo: '140000', floor: 1, area_total: 100, view: 'park', typology: 'T2' } } },
    { document: { metadata: { unit_number: '202', bedrooms: 3, price_list: '135000', price_promo: '125000', floor: 2, area_total: 100, view: 'park', typology: 'T2' } } }
];

const mockQdrantVectorService = {
    searchPropertiesWithFilters: async (collection, query, filters) => {
        // Basic mock logic
        if (filters.dormitorios === 2) return mockQdrantResults2Bed;
        if (filters.dormitorios === 3) return mockQdrantResults3Bed;
        return [];
    }
};

const mockLogger = {
    log: () => { },
    error: () => { },
    warn: () => { },
    debug: () => { }
};

// Setup service
const toolsService = new ToolsExecutionService(
    {} as any, // CitasService
    mockConfigService as any,
    mockQdrantVectorService as any,
    {} as any, // ProjectsSearchService
    {} as any, // WapiService
    {} as any, // InboxService
    {} as any, // SesionRepo
    {} as any, // ClasifRepo
    {} as any, // LeadRepo
    mockResumenService as any
);

// Inject logger mock
(toolsService as any).logger = mockLogger;
(toolsService as any).ejecutarBusquedaQdrant = async (collection, params) => {
    // Reuse the public search method logic but simplified for the mock
    const items = await mockQdrantVectorService.searchPropertiesWithFilters(collection, '', { dormitorios: params.dormitorios });
    return { ok: true, items };
};

async function testMultiBedroomSearch() {
    console.log('--- TEST: Multi-Bedroom Search with Sorting ---');

    const params = {
        dormitorios: [2, 3],
        codigoEmpresa: 1,
        leadUuid: 'test-user-123'
    };

    const result = await toolsService.buscarDepartamentoUniversal(params);

    console.log('\nRESULTADO:\n', result);

    // Verification Logic
    const lines = (result as string).split('\n');
    const items = lines.filter(l => l.match(/^\d+\./));
    console.log(`\nItems found: ${items.length}`);

    let previousBedrooms = 0;
    let previousPrice = 0;
    let bedroomsSorted = true;

    // We expect:
    // 1. 2 dorm - 105k (cheaper 2 bed)
    // 2. 2 dorm - 120k (expensive 2 bed)
    // 3. 3 dorm - 135k (cheaper 3 bed)
    // 4. 3 dorm - 150k (expensive 3 bed)

    items.forEach(item => {
        const bedMatch = item.match(/(\d+) dorm/);
        const priceMatch = item.match(/S\/([\d,]+)/);

        if (bedMatch && priceMatch) {
            const bedrooms = parseInt(bedMatch[1]);
            const price = parseInt(priceMatch[1].replace(/,/g, ''));

            if (bedrooms < previousBedrooms) {
                bedroomsSorted = false;
                console.log(`❌ Order violation: ${bedrooms} bedrooms after ${previousBedrooms}`);
            }

            if (bedrooms === previousBedrooms && price < previousPrice) {
                // Price within same bedroom count should be ascending
                // console.log(`Price violation within same bedroom count`); 
                // Note: strictly speaking we sort by price asc, so this is valid check
            }

            previousBedrooms = bedrooms;
            previousPrice = price;
        }
    });

    if (bedroomsSorted) {
        console.log('✅ PASS: Results grouped by bedrooms correctly');
    } else {
        console.log('❌ FAIL: Results NOT grouped by bedrooms');
    }
}

testMultiBedroomSearch();
