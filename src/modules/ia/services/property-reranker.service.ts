import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { PropertyResult } from './property-search.service';

export interface ClientProfile {
  urgency: 'high' | 'medium' | 'low';
  budget_sensitivity: 'high' | 'medium' | 'low';
  feature_preferences: {
    view?: 'exterior' | 'interior';
    floor_preference?: 'low' | 'medium' | 'high';
    area_importance?: 'high' | 'medium' | 'low';
  };
  interaction_history: {
    viewed_properties: number[];
    clicked_floor_plans: number[];
    asked_about: number[];
  };
}

export interface RankedProperty extends PropertyResult {
  rank: number;
  score_final: number;
  razonamiento: string;
}

@Injectable()
export class PropertyRerankerService {
  private readonly logger = new Logger(PropertyRerankerService.name);
  private readonly llm: ChatOpenAI;

  constructor(private readonly configService: ConfigService) {
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0.2,
      openAIApiKey: this.configService.get('OPENAI_API_KEY'),
    });
  }

  async rerankProperties(
    properties: PropertyResult[],
    conversationHistory: string,
    clientProfile: Partial<ClientProfile>,
  ): Promise<RankedProperty[]> {
    if (properties.length === 0) {
      return [];
    }

    const scoredProperties = properties.map((property, index) => {
      const baseScore = property.score || 0.5;
      const preferenceScore = this.calculatePreferenceScore(property, clientProfile);
      const promotionScore = this.calculatePromotionScore(property);
      const interactionScore = this.calculateInteractionScore(property, clientProfile);

      const scoreWeights = {
        base: 0.40,
        preference: 0.25,
        promotion: 0.20,
        interaction: 0.15,
      };

      const finalScore = 
        (baseScore * scoreWeights.base) +
        (preferenceScore * scoreWeights.preference) +
        (promotionScore * scoreWeights.promotion) +
        (interactionScore * scoreWeights.interaction);

      const razonamiento = this.generateReasoning(
        property,
        clientProfile,
        { baseScore, preferenceScore, promotionScore, interactionScore }
      );

      return {
        ...property,
        rank: 0,
        score_final: finalScore,
        razonamiento,
      };
    });

    const rankedProperties = scoredProperties
      .sort((a, b) => b.score_final - a.score_final)
      .map((prop, index) => ({
        ...prop,
        rank: index + 1,
      }));

    this.logger.log(`Reranked ${rankedProperties.length} properties`);
    
    return rankedProperties;
  }

  private calculatePreferenceScore(
    property: PropertyResult,
    profile: Partial<ClientProfile>
  ): number {
    let score = 0.5;

    if (!profile.feature_preferences) {
      return score;
    }

    const prefs = profile.feature_preferences;

    if (prefs.view && property.view === prefs.view) {
      score += 0.3;
    }

    if (prefs.floor_preference) {
      if (prefs.floor_preference === 'low' && property.floor <= 6) {
        score += 0.2;
      } else if (prefs.floor_preference === 'medium' && property.floor >= 7 && property.floor <= 12) {
        score += 0.2;
      } else if (prefs.floor_preference === 'high' && property.floor >= 13) {
        score += 0.2;
      }
    }

    if (prefs.area_importance === 'high' && property.area_total >= 50) {
      score += 0.15;
    }

    return Math.min(score, 1.0);
  }

  private calculatePromotionScore(property: PropertyResult): number {
    if (!property.price_promo || property.price_promo >= property.price_list) {
      return 0.3;
    }

    const discount = (property.price_list - property.price_promo) / property.price_list;

    if (discount >= 0.15) return 1.0;
    if (discount >= 0.10) return 0.85;
    if (discount >= 0.05) return 0.70;
    return 0.50;
  }

  private calculateInteractionScore(
    property: PropertyResult,
    profile: Partial<ClientProfile>
  ): number {
    if (!profile.interaction_history) {
      return 0.5;
    }

    const history = profile.interaction_history;
    let score = 0.5;

    if (history.viewed_properties?.includes(property.id_mysql)) {
      score += 0.15;
    }

    if (history.clicked_floor_plans?.includes(property.id_mysql)) {
      score += 0.20;
    }

    if (history.asked_about?.includes(property.id_mysql)) {
      score += 0.25;
    }

    return Math.min(score, 1.0);
  }

  private generateReasoning(
    property: PropertyResult,
    profile: Partial<ClientProfile>,
    scores: {
      baseScore: number;
      preferenceScore: number;
      promotionScore: number;
      interactionScore: number;
    }
  ): string {
    const reasons: string[] = [];

    if (scores.baseScore > 0.8) {
      reasons.push('Excelente match con tu búsqueda');
    }

    if (property.view === profile.feature_preferences?.view) {
      reasons.push(`Vista ${property.view} como prefieres`);
    }

    if (property.price_promo && property.price_promo < property.price_list) {
      const discount = ((property.price_list - property.price_promo) / property.price_list * 100).toFixed(0);
      reasons.push(`Promoción activa ${discount}% descuento`);
    }

    if (profile.urgency === 'high' && property.promo_end_date) {
      reasons.push('Promoción por vencer, aprovecha ahora');
    }

    if (profile.interaction_history?.viewed_properties?.includes(property.id_mysql)) {
      reasons.push('Ya mostraste interés antes');
    }

    if (property.bedrooms >= 2 && property.area_total >= 50) {
      reasons.push('Amplio y espacioso');
    }

    if (reasons.length === 0) {
      reasons.push('Buena opción dentro de tus criterios');
    }

    return reasons.join(' + ');
  }

  inferClientProfile(conversationHistory: string, contextData: any): Partial<ClientProfile> {
    const profile: Partial<ClientProfile> = {
      feature_preferences: {},
      interaction_history: {
        viewed_properties: [],
        clicked_floor_plans: [],
        asked_about: [],
      },
    };

    const lowerHistory = conversationHistory.toLowerCase();

    if (lowerHistory.includes('urgente') || lowerHistory.includes('rápido') || lowerHistory.includes('pronto')) {
      profile.urgency = 'high';
    } else if (lowerHistory.includes('tranquilo') || lowerHistory.includes('sin apuro')) {
      profile.urgency = 'low';
    } else {
      profile.urgency = 'medium';
    }

    if (lowerHistory.includes('económico') || lowerHistory.includes('barato') || lowerHistory.includes('precio')) {
      profile.budget_sensitivity = 'high';
    } else if (lowerHistory.includes('premium') || lowerHistory.includes('lujo')) {
      profile.budget_sensitivity = 'low';
    } else {
      profile.budget_sensitivity = 'medium';
    }

    if (lowerHistory.includes('vista exterior') || lowerHistory.includes('balcón') || lowerHistory.includes('iluminado')) {
      profile.feature_preferences.view = 'exterior';
    } else if (lowerHistory.includes('vista interior')) {
      profile.feature_preferences.view = 'interior';
    }

    if (lowerHistory.includes('piso alto') || lowerHistory.includes('arriba')) {
      profile.feature_preferences.floor_preference = 'high';
    } else if (lowerHistory.includes('piso bajo') || lowerHistory.includes('abajo')) {
      profile.feature_preferences.floor_preference = 'low';
    }

    if (lowerHistory.includes('amplio') || lowerHistory.includes('espacioso') || lowerHistory.includes('grande')) {
      profile.feature_preferences.area_importance = 'high';
    }

    return profile;
  }
}
