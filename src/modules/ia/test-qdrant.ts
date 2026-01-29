import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAIEmbeddings } from '@langchain/openai';
import * as dotenv from 'dotenv';

dotenv.config();

async function testQdrantStructure() {
  const qdrantClient = new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
  });

  const embeddings = new OpenAIEmbeddings({
    modelName: 'text-embedding-3-small',
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const collectionName = process.env.QDRANT_COLLECTION_NAME || 'checor-los-lirios-e2c76d6a';

  console.log(`\n=== Test Qdrant Collection: ${collectionName} ===\n`);

  try {
    const collections = await qdrantClient.getCollections();
    console.log('Colecciones disponibles:', collections.collections.map(c => c.name));

    const collectionInfo = await qdrantClient.getCollection(collectionName);
    console.log('\nInfo de la colección:', {
      status: collectionInfo.status,
      points_count: collectionInfo.points_count,
      indexed_vectors: collectionInfo.indexed_vectors_count,
    });

    const query = 'cuota referencial 1 dormitorio';
    console.log(`\nBuscando: "${query}"`);

    const vector = await embeddings.embedQuery(query);
    console.log(`Vector generado: ${vector.length} dimensiones`);

    const searchResult = await qdrantClient.search(collectionName, {
      vector: vector,
      limit: 3,
      with_payload: true,
    });

    console.log(`\nResultados encontrados: ${searchResult.length}`);

    searchResult.forEach((result, index) => {
      console.log(`\n--- Documento ${index + 1} ---`);
      console.log('ID:', result.id);
      console.log('Score:', result.score);
      console.log('Payload:', JSON.stringify(result.payload, null, 2));
    });

    console.log('\n=== Test Completado ===\n');
    process.exit(0);
  } catch (error) {
    console.error('Error en test:', error.message);
    process.exit(1);
  }
}

testQdrantStructure();
