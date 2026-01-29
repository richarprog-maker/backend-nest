import { Injectable, Logger } from '@nestjs/common';
import { QdrantVectorService } from '../qdrant-vector.service';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';

export interface SearchCriteria {
  numero_dormitorios?: number;
  presupuesto_mensual?: number;
  presupuesto_total_max?: number;
  vista_preferida?: 'exterior' | 'interior';
  piso_preferido?: 'bajo' | 'medio' | 'alto';
  tipologia?: string;
  area_minima?: number;
  tipo_inmueble?: 'Flat' | 'Dúplex';
  distrito?: string;
  urgencia?: 'alta' | 'media' | 'baja';
  uso?: 'vivienda' | 'inversion';
}

export interface PropertyResult {
  id_mysql: number;
  project_name: string;
  unit_number: string;
  typology: string;
  bedrooms: number;
  floor: number;
  view: string;
  area_total: number;
  area_techada: number;
  area_libre: number;
  price_list: number;
  price_promo: number;
  currency: string;
  promo_end_date: string;
  url_floor_plan: string;
  url_location: string;
  url_floor_plan_2: string;
  score: number;
  relevance_explanation: string;
}

@Injectable()
export class PropertySearchService {
  private readonly logger = new Logger(PropertySearchService.name);
  private readonly llm: ChatOpenAI;
  private readonly collectionName: string;

  constructor(
    private readonly qdrantService: QdrantVectorService,
    private readonly configService: ConfigService,
  ) {
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0.3,
      openAIApiKey: this.configService.get('OPENAI_API_KEY'),
    });

    this.collectionName = this.configService.get('QDRANT_PROJECTS_COLLECTION_NAME') || 'propiedades-los-lirios';
  }

  async buscarPropiedadInteligente(
    criteria: SearchCriteria,
    conversationContext?: string,
  ): Promise<{ properties: PropertyResult[]; message: string }> {
    const startTime = Date.now();

    try {
      const queries = this.generateMultiQueries(criteria);
      this.logger.log(`Generated ${queries.length} query variations`);

      const filters = this.buildFiltersFromCriteria(criteria);

      const allResults = new Map<number, any>();

      for (const query of queries) {
        const results = await this.qdrantService.searchPropertiesWithFilters(
          this.collectionName,
          query,
          filters,
          {
            limit: 10,
            threshold: 0.70,
            fallbackStrategy: 'relax',
          }
        );

        results.forEach(result => {
          const id = result.document.metadata.id_mysql;
          if (!allResults.has(id) || result.score > allResults.get(id).score) {
            allResults.set(id, result);
          }
        });
      }

      const uniqueResults = Array.from(allResults.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (uniqueResults.length === 0) {
        return {
          properties: [],
          message: this.generateNoResultsMessage(criteria),
        };
      }

      const properties: PropertyResult[] = uniqueResults.map(result => {
        const metadata = result.document.metadata;
        return {
          id_mysql: metadata.id_mysql,
          project_name: metadata.project_name,
          unit_number: metadata.unit_number,
          typology: metadata.typology,
          bedrooms: metadata.bedrooms,
          floor: metadata.floor,
          view: metadata.view,
          area_total: metadata.area_total,
          area_techada: metadata.area_techada,
          area_libre: metadata.area_libre,
          price_list: metadata.price_list,
          price_promo: metadata.price_promo,
          currency: metadata.currency,
          promo_end_date: metadata.promo_end_date,
          url_floor_plan: metadata.url_floor_plan,
          url_location: metadata.url_location,
          url_floor_plan_2: metadata.url_floor_plan_2,
          score: result.score,
          relevance_explanation: this.generateRelevanceExplanation(metadata, criteria, result.breakdown),
        };
      });

      const message = await this.formatPropertiesForClient(properties, criteria);

      const elapsedTime = Date.now() - startTime;
      this.logger.log(`Search completed in ${elapsedTime}ms - Found ${properties.length} properties`);

      return { properties, message };

    } catch (error) {
      this.logger.error(`Error in buscarPropiedadInteligente: ${error.message}`, error.stack);
      throw error;
    }
  }

  private generateMultiQueries(criteria: SearchCriteria): string[] {
    const queries: string[] = [];

    let baseQuery = 'departamento';

    if (criteria.numero_dormitorios) {
      baseQuery += ` ${criteria.numero_dormitorios} dormitorios`;
    }

    if (criteria.vista_preferida) {
      baseQuery += ` vista ${criteria.vista_preferida}`;
    }

    if (criteria.piso_preferido) {
      baseQuery += ` piso ${criteria.piso_preferido}`;
    }

    queries.push(baseQuery);

    if (criteria.numero_dormitorios === 1) {
      queries.push('departamento compacto funcional iluminado');
      queries.push('flat moderno una habitación');
    } else if (criteria.numero_dormitorios === 2) {
      queries.push('amplio departamento dos habitaciones espacioso');
      queries.push('flat familiar 2 dormitorios bien distribuido');
    } else if (criteria.numero_dormitorios && criteria.numero_dormitorios >= 3) {
      queries.push('departamento grande familiar múltiples ambientes');
      queries.push('amplia unidad residencial para familia');
    }

    if (criteria.vista_preferida === 'exterior') {
      queries.push('departamento con balcón iluminado natural');
    }

    return queries.slice(0, 3);
  }

  private buildFiltersFromCriteria(criteria: SearchCriteria): any {
    const filters: any = {};

    if (criteria.numero_dormitorios !== undefined) {
      filters.dormitorios = criteria.numero_dormitorios;
    }

    if (criteria.presupuesto_total_max) {
      filters.precioMax = criteria.presupuesto_total_max;
    }

    if (criteria.vista_preferida) {
      filters.vista = criteria.vista_preferida;
    }

    if (criteria.piso_preferido) {
      if (criteria.piso_preferido === 'bajo') {
        filters.pisoMin = 1;
        filters.pisoMax = 6;
      } else if (criteria.piso_preferido === 'medio') {
        filters.pisoMin = 7;
        filters.pisoMax = 12;
      } else if (criteria.piso_preferido === 'alto') {
        filters.pisoMin = 13;
      }
    }

    if (criteria.tipologia) {
      filters.tipologia = criteria.tipologia;
    }

    if (criteria.area_minima) {
      filters.areaMin = criteria.area_minima;
    }

    return filters;
  }

  private generateRelevanceExplanation(metadata: any, criteria: SearchCriteria, breakdown: any): string {
    const reasons: string[] = [];

    if (criteria.numero_dormitorios && metadata.bedrooms === criteria.numero_dormitorios) {
      reasons.push(`${metadata.bedrooms} dormitorios como solicitaste`);
    }

    if (criteria.vista_preferida && metadata.view === criteria.vista_preferida) {
      reasons.push(`vista ${metadata.view}`);
    }

    if (metadata.price_promo && metadata.price_promo < metadata.price_list) {
      const discount = ((metadata.price_list - metadata.price_promo) / metadata.price_list * 100).toFixed(0);
      reasons.push(`promoción activa ${discount}% descuento`);
    }

    if (criteria.presupuesto_total_max && metadata.price_promo <= criteria.presupuesto_total_max) {
      reasons.push('dentro de tu presupuesto');
    }

    if (reasons.length === 0) {
      reasons.push('buena opción por ubicación y características');
    }

    return reasons.join(', ');
  }

  private async formatPropertiesForClient(properties: PropertyResult[], criteria: SearchCriteria): Promise<string> {
    const propertiesText = properties.map((prop, index) => {
      const moneda = prop.currency === 'soles' ? 'S/' : 'USD';
      const dormitorios = prop.bedrooms === 0 ? 'Monoambiente' : `${prop.bedrooms} ${prop.bedrooms === 1 ? 'dormitorio' : 'dormitorios'}`;
      
      let text = `\n${index + 1}. ${prop.project_name} - Unidad ${prop.unit_number}\n`;
      text += `   ${dormitorios} | Piso ${prop.floor} | Vista ${prop.view}\n`;
      text += `   Área: ${prop.area_total} m2`;
      
      if (prop.area_techada && prop.area_libre) {
        text += ` (${prop.area_techada} m2 techados + ${prop.area_libre} m2 libres)`;
      }
      
      text += `\n   Precio lista: ${moneda} ${prop.price_list.toLocaleString('es-PE')}`;
      
      if (prop.price_promo && prop.price_promo < prop.price_list) {
        const discount = ((prop.price_list - prop.price_promo) / prop.price_list * 100).toFixed(0);
        text += `\n   PROMOCIÓN: ${moneda} ${prop.price_promo.toLocaleString('es-PE')} (${discount}% descuento)`;
        if (prop.promo_end_date) {
          text += ` - Vigente hasta ${prop.promo_end_date}`;
        }
      }
      
      if (prop.url_floor_plan) {
        text += `\n   Plano: ${prop.url_floor_plan}`;
      }
      
      if (prop.url_floor_plan_2) {
        text += `\n   Plano adicional: ${prop.url_floor_plan_2}`;
      }
      
      if (prop.url_location) {
        text += `\n   Ubicación: ${prop.url_location}`;
      }
      
      text += `\n   ${prop.relevance_explanation}`;
      
      return text;
    }).join('\n');

    return `Encontré ${properties.length} ${properties.length === 1 ? 'opción' : 'opciones'} que ${properties.length === 1 ? 'podría' : 'podrían'} interesarte:\n${propertiesText}\n\n¿Te gustaría más información sobre alguna de estas opciones o agendar una visita?`;
  }

  private generateNoResultsMessage(criteria: SearchCriteria): string {
    let message = 'No encontré propiedades que coincidan exactamente con tus criterios';
    
    if (criteria.numero_dormitorios) {
      message += ` de ${criteria.numero_dormitorios} dormitorios`;
    }
    
    if (criteria.vista_preferida) {
      message += ` con vista ${criteria.vista_preferida}`;
    }
    
    if (criteria.presupuesto_total_max) {
      message += ` en el rango de presupuesto especificado`;
    }
    
    message += '. ¿Te gustaría que busque con criterios más flexibles o que te muestre las opciones más cercanas a lo que buscas?';
    
    return message;
  }

  async handlePriceObjection(
    currentProperties: PropertyResult[],
    budgetReduction: number = 0.85,
  ): Promise<{ properties: PropertyResult[]; message: string }> {
    this.logger.log(`Handling price objection with ${budgetReduction * 100}% of original budget`);

    if (currentProperties.length === 0) {
      return {
        properties: [],
        message: 'No tengo propiedades previas para ajustar el presupuesto. ¿Podrías indicarme cuál es tu presupuesto máximo?',
      };
    }

    const avgPrice = currentProperties.reduce((sum, p) => sum + (p.price_promo || p.price_list), 0) / currentProperties.length;
    const newMaxBudget = avgPrice * budgetReduction;

    const criteria: SearchCriteria = {
      numero_dormitorios: currentProperties[0].bedrooms,
      presupuesto_total_max: newMaxBudget,
    };

    return await this.buscarPropiedadInteligente(criteria);
  }
}
