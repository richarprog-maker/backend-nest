
import { Injectable, Logger } from '@nestjs/common';
import { QdrantVectorService } from './qdrant-vector.service';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { DataSource } from 'typeorm';

@Injectable()
export class ProjectsSearchService {
    private readonly logger = new Logger(ProjectsSearchService.name);
    private collectionName: string;
    private llm: ChatOpenAI;

    constructor(
        private readonly qdrantService: QdrantVectorService,
        private readonly configService: ConfigService,
        private readonly dataSource: DataSource
    ) {
        this.collectionName = this.configService.get<string>('QDRANT_PROJECTS_COLLECTION_NAME');

        // Initialize LLM for filter extraction (cheap model is fine usually)
        this.llm = new ChatOpenAI({
            modelName: 'gpt-4o-mini',
            temperature: 0,
            openAIApiKey: this.configService.get('OPENAI_API_KEY'),
        });
    }

    /**
     * Main entry point for searching properties
     */
    async searchProperties(userQuery: string, limit: number = 5, context: any = {}) {
        if (!this.collectionName) {
            throw new Error('QDRANT_PROJECTS_COLLECTION_NAME is not configured');
        }

        // 1. Extract Filters using LLM
        const filters = await this.extractFiltersFromQuery(userQuery);
        this.logger.log(`🔍 Extracted filters: ${JSON.stringify(filters)}`);

        // 2. Build Qdrant Filter
        const qdrantFilter: any = {
            must: [],
            should: [], // Optional criteria
        };

        if (filters.bedrooms) {
            // Strict match for bedrooms if specified
            qdrantFilter.must.push({
                key: 'metadata.bedrooms',
                match: { value: filters.bedrooms }
            });
        }

        if (filters.maxPrice) {
            // Range filter for price (checking both list and promo prices if needed, usually promo)
            qdrantFilter.must.push({
                key: 'metadata.price_promo',
                range: { lte: filters.maxPrice }
            });
        }

        if (filters.view) {
            // View preference (can be strict or soft, let's make it strict for 'must' if explicitly asked)
            qdrantFilter.must.push({
                key: 'metadata.view',
                match: { value: filters.view.toLowerCase() }
            });
        }

        if (filters.floor) {
            qdrantFilter.must.push({
                key: 'metadata.floor',
                match: { value: filters.floor }
            });
        }

        // Cleaning empty filter object if no constraints
        const searchFilter = qdrantFilter.must.length > 0 ? qdrantFilter : undefined;

        // 3. Perform Hybrid Search
        // We use similaritySearch from QdrantService which returns documents
        // Note: The service implementation uses 'filter' argument directly passed to QdrantClient
        const uniqueResults = await this.qdrantService.similaritySearch(
            this.collectionName,
            userQuery,
            limit,
            searchFilter
        );


        this.logSearchResults(userQuery, filters, uniqueResults, context);

        return {
            filters_applied: filters,
            results: uniqueResults
        };
    }


    async extractFiltersFromQuery(query: string) {
        const parser = {
            // Define schema for structured output
            name: "extract_filters",
            description: "Extract real estate property filters from user query",
            parameters: {
                type: "object",
                properties: {
                    bedrooms: { type: "integer", description: "Number of bedrooms desired" },
                    maxPrice: { type: "number", description: "Maximum budget or price mentioned" },
                    view: { type: "string", enum: ["interior", "exterior"], description: "View preference" },
                    floor: { type: "integer", description: "Specific floor number if mentioned" }
                },
                required: []
            }
        };

        // Use function calling to extract structured data
        const result = await this.llm.invoke([
            { role: "system", content: "You are a helpful assistant that extracts real estate search criteria." },
            { role: "user", content: query }
        ], {
            functions: [parser],
            function_call: { name: "extract_filters" }
        });

        const val = result.additional_kwargs.function_call?.arguments;
        return val ? JSON.parse(val) : {};
    }

    /**
     * Log search execution details to tbl_historial_chat_ai
     * This helps in debugging and analytics without polluting the main chat logic
     */
    private async logSearchResults(query: string, filters: any, results: any[], context: any) {
        if (!context || !context.leadUuid || !context.companyId) {
            return; // Skip if no context
        }

        const metadata = {
            type: 'RAG_SEARCH_LOG',
            query,
            filters,
            result_count: results.length,
            top_results: results.slice(0, 3).map(r => ({
                id: r.metadata.id_mysql,
                project: r.metadata.project_name,
                unit: r.metadata.unit_number
            }))
        };


        try {
            await this.dataSource.query(`
            INSERT INTO tbl_historial_chat_ai (
                lead_uuid, codigo_empresa, input, role, metadatos
            ) VALUES (?, ?, ?, ?, ?)
        `, [
                context.leadUuid,
                context.companyId,
                JSON.stringify({ content: `RAG Search Executed: ${query}`, system_info: true }),
                'system',
                JSON.stringify(metadata)
            ]);
        } catch (e) {
            this.logger.error(`Failed to log search results: ${e.message}`);
        }
    }
}
