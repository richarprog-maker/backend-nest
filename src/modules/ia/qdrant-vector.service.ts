import { Injectable, Logger } from '@nestjs/common';
import { QdrantVectorStore } from '@langchain/qdrant';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import { Document } from '@langchain/core/documents';

/**
 * Servicio que proporciona acceso a Qdrant usando LangChain QdrantVectorStore
 * Reemplaza el uso manual de QdrantClient + embeddings + search
 * 

 */
@Injectable()
export class QdrantVectorService {
  private readonly logger = new Logger(QdrantVectorService.name);
  private readonly qdrantClient: QdrantClient;
  private readonly embeddings: OpenAIEmbeddings;
  private vectorStoreCache: Map<string, QdrantVectorStore> = new Map();

  constructor() {
    // Cliente Qdrant (mantener el existente)
    this.qdrantClient = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      apiKey: process.env.QDRANT_API_KEY,
    });

    // Embeddings OpenAI
    this.embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    this.logger.log(' QdrantVectorService inicializado con LangChain');
  }

  /**
   * Obtiene un VectorStore para una colección específica
   * Usa cache para no recrear instancias
   * 
   */
  async getVectorStore(collectionName: string): Promise<QdrantVectorStore> {
    // Verificar cache
    if (this.vectorStoreCache.has(collectionName)) {
      return this.vectorStoreCache.get(collectionName);
    }

    // Verificar que la colección existe
    const collections = await this.qdrantClient.getCollections();
    const exists = collections.collections.some(c => c.name === collectionName);

    if (!exists) {
      throw new Error(`Colección '${collectionName}' no existe en Qdrant`);
    }

    // Crear VectorStore desde colección existente
    const vectorStore = await QdrantVectorStore.fromExistingCollection(
      this.embeddings,
      {
        client: this.qdrantClient,
        collectionName: collectionName,
        contentPayloadKey: 'pageContent', // Intentamos estandarizar
        metadataPayloadKey: 'metadata',
      }
    );

    // Guardar en cache
    this.vectorStoreCache.set(collectionName, vectorStore);
    this.logger.log(`VectorStore creado para colección: ${collectionName}`);

    return vectorStore;
  }

  /**
   * Crea un Retriever configurado para RAG
   * 
   * @param collectionName - Nombre de la colección
   * @param options - Opciones del retriever
   * @returns VectorStoreRetriever listo para usar en Chains
   */
  async getRetriever(
    collectionName: string,
    options: {
      k?: number; // Número de documentos a retornar (default: 3)
      filter?: Record<string, any>; // Filtros Qdrant
      searchType?: 'similarity' | 'mmr'; // Tipo de búsqueda
    } = {}
  ): Promise<VectorStoreRetriever<QdrantVectorStore>> {
    const vectorStore = await this.getVectorStore(collectionName);

    const { k = 3, filter, searchType = 'similarity' } = options;

    // Crear retriever con configuración
    const retriever = vectorStore.asRetriever({
      k,
      filter,
      searchType,
      verbose: process.env.NODE_ENV !== 'production',
    });

    this.logger.log(`Retriever creado - k: ${k}, tipo: ${searchType}`);
    return retriever;
  }

  /**
   * Búsqueda directa con filtros (para casos específicos)
   * Mantiene compatibilidad con código existente
   * 
   * @param collectionName - Nombre de la colección
   * @param query - Texto de búsqueda
   * @param k - Número de resultados
   * @param filter - Filtros Qdrant
   * @returns Documentos encontrados
   */
  async similaritySearch(
    collectionName: string,
    query: string,
    k: number = 3,
    filter?: Record<string, any>
  ): Promise<Document[]> {
    const vector = await this.embeddings.embedQuery(query);

    const searchResult = await this.qdrantClient.search(collectionName, {
      vector: vector,
      limit: k,
      filter: filter,
      with_payload: true,
    });

    const documents = searchResult.map(result => {
      const payload: any = result.payload || {};
      const content = String(payload.content || payload.text || payload.pageContent || '');

      return new Document({
        pageContent: content,
        metadata: payload,
      });
    });

    this.logger.log(`Búsqueda: "${query}" - ${documents.length} docs encontrados`);
    return documents;
  }

  /**
   * Búsqueda con scores (para debugging o filtrado por relevancia)
   * 
   * @param collectionName - Nombre de la colección
   * @param query - Texto de búsqueda
   * @param k - Número de resultados
   * @param filter - Filtros Qdrant
   * @returns Documentos con scores
   */
  async similaritySearchWithScore(
    collectionName: string,
    query: string,
    k: number = 3,
    filter?: Record<string, any>
  ): Promise<[Document, number][]> {
    const vectorStore = await this.getVectorStore(collectionName);

    const results = await vectorStore.similaritySearchWithScore(query, k, filter);

    this.logger.log(
      `Búsqueda con scores: "${query}" → ${results.map(([_, score]) => score.toFixed(3)).join(', ')}`
    );
    return results;
  }

  /**
   * Agrega documentos a una colección
   * (Útil para indexar nuevos documentos desde el backend)
   * 
   * @param collectionName - Nombre de la colección
   * @param documents - Documentos a agregar
   * @returns IDs de los documentos agregados
   */
  async addDocuments(
    collectionName: string,
    documents: Document[]
  ): Promise<string[] | void> {
    const vectorStore = await this.getVectorStore(collectionName);

    await vectorStore.addDocuments(documents);

    this.logger.log(`Agregados ${documents.length} documentos a '${collectionName}'`);
  }

  /**
   * Limpia el cache de VectorStores
   * (Útil si se actualizan colecciones)
   */
  clearCache(collectionName?: string) {
    if (collectionName) {
      this.vectorStoreCache.delete(collectionName);
      this.logger.log(`Cache limpiado para '${collectionName}'`);
    } else {
      this.vectorStoreCache.clear();
      this.logger.log('Cache completo limpiado');
    }
  }
  /**
   * Recrea una colección (Borra si existe y crea nueva)
   * 
   * @param collectionName - Nombre de la colección
   * @param vectorSize - Tamaño del vector (default 1536 para OpenAI small)
   */
  async recreateCollection(collectionName: string, vectorSize: number = 1536): Promise<void> {
    try {
      this.logger.log(`Recreando colección: ${collectionName}`);

      try {
        await this.qdrantClient.deleteCollection(collectionName);
        this.logger.log(`Colección eliminada: ${collectionName}`);
      } catch (e) {
        // Ignorar error si no existe
      }

      await this.qdrantClient.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      });

      this.logger.log(`Colección creada: ${collectionName}`);
      this.clearCache(collectionName);

    } catch (error) {
      this.logger.error(`Error recreando colección ${collectionName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Búsqueda híbrida de propiedades con filtros pre-search y scoring combinado
   * 
   * @param collectionName - Nombre de la colección
   * @param query - Query semántica del usuario
   * @param filters - Filtros estructurados
   * @param options - Opciones de búsqueda
   * @returns Documentos rankeados con scoring combinado
   */
  async searchPropertiesWithFilters(
    collectionName: string,
    query: string,
    filters: {
      dormitorios?: number;
      precioMin?: number;
      precioMax?: number;
      vista?: 'exterior' | 'interior';
      pisoMin?: number;
      pisoMax?: number;
      tipologia?: string;
      areaMin?: number;
    } = {},
    options: {
      limit?: number;
      threshold?: number;
      fallbackStrategy?: 'relax' | 'expand' | 'none';
    } = {}
  ): Promise<Array<{ document: Document; score: number; breakdown: any }>> {
    const { limit = 5, threshold = 0.75, fallbackStrategy = 'relax' } = options;

    const qdrantFilter = this.buildQdrantFilter(filters);

    let results = await this.searchWithScoring(
      collectionName,
      query,
      limit * 2,
      threshold,
      qdrantFilter
    );

    if (results.length < 2 && fallbackStrategy !== 'none') {
      this.logger.log('Pocos resultados, aplicando estrategia de fallback');
      results = await this.applyFallbackStrategy(
        collectionName,
        query,
        filters,
        fallbackStrategy,
        limit
      );
    }

    return results.slice(0, limit);
  }

  private buildQdrantFilter(filters: any): any {
    const conditions: any[] = [];

    if (filters.dormitorios !== undefined) {
      conditions.push({
        key: 'metadata.bedrooms',
        match: { value: filters.dormitorios }
      });
    }

    if (filters.precioMin !== undefined || filters.precioMax !== undefined) {
      const priceOrConditions: any[] = [];

      // Condición 1: El precio de lista está en el rango
      const listRange: any = {};
      if (filters.precioMin) listRange.gte = filters.precioMin;
      if (filters.precioMax) listRange.lte = filters.precioMax;
      priceOrConditions.push({ key: 'metadata.price_list', range: listRange });

      // Condición 2: El precio de promoción está en el rango
      const promoRange: any = {};
      if (filters.precioMin) promoRange.gte = filters.precioMin;
      if (filters.precioMax) promoRange.lte = filters.precioMax;
      priceOrConditions.push({ key: 'metadata.price_promo', range: promoRange });

      // Agregamos como condición SHOULD (OR) anidada dentro del MUST principal
      // Significa: (price_list in range OR price_promo in range)
      conditions.push({
        filter: {
          should: priceOrConditions
        }
      });
    }

    if (filters.vista) {
      conditions.push({
        key: 'metadata.view',
        match: { value: filters.vista.toLowerCase() }
      });
    }

    if (filters.pisoMin !== undefined || filters.pisoMax !== undefined) {
      const floorRange: any = {};
      if (filters.pisoMin) floorRange.gte = filters.pisoMin;
      if (filters.pisoMax) floorRange.lte = filters.pisoMax;
      conditions.push({
        key: 'metadata.floor',
        range: floorRange
      });
    }

    if (filters.tipologia) {
      conditions.push({
        key: 'metadata.typology',
        match: { value: filters.tipologia }
      });
    }

    if (filters.areaMin) {
      conditions.push({
        key: 'metadata.area_total',
        range: { gte: filters.areaMin }
      });
    }

    conditions.push({
      key: 'metadata.availability',
      match: { value: 'sí' }
    });

    const finalFilter = conditions.length > 0 ? { must: conditions } : undefined;
    this.logger.log(`>>> Filtro Qdrant construido: ${JSON.stringify(finalFilter)}`);
    return finalFilter;
  }

  private async searchWithScoring(
    collectionName: string,
    query: string,
    limit: number,
    threshold: number,
    filter?: any
  ): Promise<Array<{ document: Document; score: number; breakdown: any }>> {
    const vector = await this.embeddings.embedQuery(query);

    const searchResult = await this.qdrantClient.search(collectionName, {
      vector: vector,
      limit: limit,
      filter: filter,
      with_payload: true,
      score_threshold: threshold,
    });

    if (searchResult.length > 0) {
      this.logger.debug(`Qdrant: ${searchResult.length} resultados, score: ${searchResult[0].score.toFixed(3)}`);
    }

    return searchResult.map(result => {
      const payload: any = result.payload || {};
      const similarityScore = result.score || 0;

      // Extract metadata from payload (Qdrant stores it as payload.metadata)
      const metadata = payload.metadata || {};

      const priceScore = this.calculatePriceScore(metadata);
      const featureScore = this.calculateFeatureScore(metadata);

      const combinedScore = (similarityScore * 0.70) + (priceScore * 0.15) + (featureScore * 0.15);

      const document = new Document({
        pageContent: payload.pageContent || metadata.text_complete || '',
        metadata: metadata,
      });

      return {
        document,
        score: combinedScore,
        breakdown: {
          similarity: similarityScore,
          price: priceScore,
          features: featureScore,
          combined: combinedScore
        }
      };
    }).sort((a, b) => b.score - a.score);
  }

  private calculatePriceScore(payload: any): number {
    if (!payload.price_promo || !payload.price_list) return 0.5;

    const discount = (payload.price_list - payload.price_promo) / payload.price_list;

    if (discount >= 0.10) return 1.0;
    if (discount >= 0.05) return 0.8;
    if (discount > 0) return 0.6;
    return 0.4;
  }

  private calculateFeatureScore(payload: any): number {
    let score = 0.5;

    if (payload.view === 'exterior') score += 0.2;
    if (payload.floor >= 7) score += 0.15;
    if (payload.area_total >= 50) score += 0.15;

    return Math.min(score, 1.0);
  }

  private async applyFallbackStrategy(
    collectionName: string,
    query: string,
    originalFilters: any,
    strategy: 'relax' | 'expand',
    limit: number
  ): Promise<Array<{ document: Document; score: number; breakdown: any }>> {
    if (strategy === 'relax') {
      const relaxedFilters = { ...originalFilters };
      delete relaxedFilters.vista;
      delete relaxedFilters.pisoMin;
      delete relaxedFilters.pisoMax;

      const relaxedQdrantFilter = this.buildQdrantFilter(relaxedFilters);

      return await this.searchWithScoring(
        collectionName,
        query,
        limit * 2,
        0.65,
        relaxedQdrantFilter
      );
    } else if (strategy === 'expand') {
      const expandedFilters = { ...originalFilters };

      if (expandedFilters.precioMax) {
        expandedFilters.precioMax = expandedFilters.precioMax * 1.15;
      }
      if (expandedFilters.precioMin) {
        expandedFilters.precioMin = expandedFilters.precioMin * 0.85;
      }

      const expandedQdrantFilter = this.buildQdrantFilter(expandedFilters);

      return await this.searchWithScoring(
        collectionName,
        query,
        limit * 2,
        0.70,
        expandedQdrantFilter
      );
    }

    return [];
  }
}
