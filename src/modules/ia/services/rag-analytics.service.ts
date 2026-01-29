import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PropertyResult } from './property-search.service';

export interface RagAnalyticsRecord {
  id_prospecto?: number;
  coleccion_name?: string;
  query_original: string;
  filtros_aplicados: any;
  propiedades_retornadas: Array<{ id_unidad: number; score: number; rank: number }>;
  propiedad_seleccionada?: number;
  num_resultados: number;
  tiempo_respuesta_ms: number;
  threshold_usado: number;
  estrategia_fallback?: string;
  contexto_conversacional?: string;
  criterios_extraidos?: any;
}

export interface InteractionRecord {
  id_prospecto: number;
  id_unidad: number;
  id_analytic?: number;
  tipo_interaccion: 'view' | 'click_plano' | 'click_ubicacion' | 'request_info' | 'schedule_visit';
  metadata_interaccion?: any;
}

@Injectable()
export class RagAnalyticsService {
  private readonly logger = new Logger(RagAnalyticsService.name);

  constructor(private readonly dataSource: DataSource) { }

  async recordSearch(record: RagAnalyticsRecord): Promise<number> {
    try {
      const query = `
        INSERT INTO tbl_rag_analytics (
          id_prospecto,
          coleccion_name,
          query_original,
          filtros_aplicados,
          propiedades_retornadas,
          propiedad_seleccionada,
          num_resultados,
          tiempo_respuesta_ms,
          threshold_usado,
          estrategia_fallback,
          contexto_conversacional,
          criterios_extraidos
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await this.dataSource.query(query, [
        record.id_prospecto || null,
        record.coleccion_name || null,
        record.query_original,
        JSON.stringify(record.filtros_aplicados),
        JSON.stringify(record.propiedades_retornadas),
        record.propiedad_seleccionada || null,
        record.num_resultados,
        record.tiempo_respuesta_ms,
        record.threshold_usado,
        record.estrategia_fallback || null,
        record.contexto_conversacional || null,
        record.criterios_extraidos ? JSON.stringify(record.criterios_extraidos) : null,
      ]);

      const insertId = result.insertId;
      this.logger.log(`Recorded search analytics: ${insertId}`);

      return insertId;

    } catch (error) {
      this.logger.error(`Error recording search analytics: ${error.message}`, error.stack);
      throw error;
    }
  }

  async recordInteraction(interaction: InteractionRecord): Promise<void> {
    try {
      const query = `
        INSERT INTO tbl_rag_interacciones (
          id_prospecto,
          id_unidad,
          id_analytic,
          tipo_interaccion,
          metadata_interaccion
        ) VALUES (?, ?, ?, ?, ?)
      `;

      await this.dataSource.query(query, [
        interaction.id_prospecto,
        interaction.id_unidad,
        interaction.id_analytic || null,
        interaction.tipo_interaccion,
        interaction.metadata_interaccion ? JSON.stringify(interaction.metadata_interaccion) : null,
      ]);

      this.logger.log(
        `Recorded interaction: prospecto=${interaction.id_prospecto} unit=${interaction.id_unidad} type=${interaction.tipo_interaccion}`
      );

    } catch (error) {
      this.logger.error(`Error recording interaction: ${error.message}`, error.stack);
    }
  }

  async updateSelectedProperty(analyticId: number, propertyId: number): Promise<void> {
    try {
      const query = `
        UPDATE tbl_rag_analytics 
        SET propiedad_seleccionada = ?
        WHERE id_analytic = ?
      `;

      await this.dataSource.query(query, [propertyId, analyticId]);
      this.logger.log(`Updated selected property for analytic ${analyticId}: ${propertyId}`);

    } catch (error) {
      this.logger.error(`Error updating selected property: ${error.message}`, error.stack);
    }
  }

  async getSearchMetrics(options: {
    prospectoId?: number;
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
  } = {}): Promise<any[]> {
    try {
      let query = `
        SELECT 
          id_analytic,
          id_prospecto,
          query_original,
          num_resultados,
          tiempo_respuesta_ms,
          threshold_usado,
          estrategia_fallback,
          propiedad_seleccionada,
          fecha_query
        FROM tbl_rag_analytics
        WHERE 1=1
      `;

      const params: any[] = [];

      if (options.prospectoId) {
        query += ` AND id_prospecto = ?`;
        params.push(options.prospectoId);
      }

      if (options.dateFrom) {
        query += ` AND fecha_query >= ?`;
        params.push(options.dateFrom);
      }

      if (options.dateTo) {
        query += ` AND fecha_query <= ?`;
        params.push(options.dateTo);
      }

      query += ` ORDER BY fecha_query DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const results = await this.dataSource.query(query, params);
      return results;

    } catch (error) {
      this.logger.error(`Error getting search metrics: ${error.message}`, error.stack);
      return [];
    }
  }

  async calculatePrecisionAtK(k: number = 3, dateFrom?: Date): Promise<number> {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_searches,
          SUM(CASE 
            WHEN propiedad_seleccionada IS NOT NULL 
            THEN 1 
            ELSE 0 
          END) as searches_with_selection
        FROM tbl_rag_analytics
        WHERE num_resultados >= ?
        ${dateFrom ? 'AND fecha_query >= ?' : ''}
      `;

      const params: any[] = [k];
      if (dateFrom) {
        params.push(dateFrom);
      }

      const [result] = await this.dataSource.query(query, params);

      if (!result || result.total_searches === 0) {
        return 0;
      }

      const precision = result.searches_with_selection / result.total_searches;
      this.logger.log(`Precision@${k}: ${(precision * 100).toFixed(2)}%`);

      return precision;

    } catch (error) {
      this.logger.error(`Error calculating precision@${k}: ${error.message}`, error.stack);
      return 0;
    }
  }

  async getAverageResponseTime(dateFrom?: Date): Promise<number> {
    try {
      const query = `
        SELECT AVG(tiempo_respuesta_ms) as avg_time
        FROM tbl_rag_analytics
        WHERE tiempo_respuesta_ms IS NOT NULL
        ${dateFrom ? 'AND fecha_query >= ?' : ''}
      `;

      const params: any[] = dateFrom ? [dateFrom] : [];
      const [result] = await this.dataSource.query(query, params);

      const avgTime = result?.avg_time || 0;
      this.logger.log(`Average response time: ${avgTime.toFixed(0)}ms`);

      return avgTime;

    } catch (error) {
      this.logger.error(`Error calculating average response time: ${error.message}`, error.stack);
      return 0;
    }
  }

  async getTopQueriedProperties(limit: number = 10, dateFrom?: Date): Promise<any[]> {
    try {
      const query = `
        SELECT 
          u.id,
          u.unidad,
          u.nro_dormitorios,
          u.precio_lista,
          p.nombre as proyecto,
          COUNT(i.id_interaccion) as interaction_count,
          SUM(CASE WHEN i.tipo_interaccion = 'schedule_visit' THEN 1 ELSE 0 END) as visit_requests
        FROM tbl_rag_interacciones i
        JOIN tbl_unidades_proyectos u ON i.id_unidad = u.id
        JOIN tbl_proyectos p ON u.id_proyecto = p.id
        ${dateFrom ? 'WHERE i.fecha_interaccion >= ?' : ''}
        GROUP BY u.id
        ORDER BY interaction_count DESC
        LIMIT ?
      `;

      const params: any[] = dateFrom ? [dateFrom, limit] : [limit];
      const results = await this.dataSource.query(query, params);

      return results;

    } catch (error) {
      this.logger.error(`Error getting top queried properties: ${error.message}`, error.stack);
      return [];
    }
  }

  async getPerformanceReport(dateFrom?: Date): Promise<any> {
    try {
      const [
        precisionAt3,
        avgResponseTime,
        topProperties,
        searchStats
      ] = await Promise.all([
        this.calculatePrecisionAtK(3, dateFrom),
        this.getAverageResponseTime(dateFrom),
        this.getTopQueriedProperties(5, dateFrom),
        this.getSearchStats(dateFrom),
      ]);

      return {
        precision_at_3: precisionAt3,
        avg_response_time_ms: avgResponseTime,
        total_searches: searchStats.total_searches,
        avg_results_per_search: searchStats.avg_results,
        fallback_usage_rate: searchStats.fallback_rate,
        top_properties: topProperties,
        generated_at: new Date(),
      };

    } catch (error) {
      this.logger.error(`Error generating performance report: ${error.message}`, error.stack);
      return null;
    }
  }

  private async getSearchStats(dateFrom?: Date): Promise<any> {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_searches,
          AVG(num_resultados) as avg_results,
          SUM(CASE WHEN estrategia_fallback IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) as fallback_rate
        FROM tbl_rag_analytics
        ${dateFrom ? 'WHERE fecha_query >= ?' : ''}
      `;

      const params: any[] = dateFrom ? [dateFrom] : [];
      const [result] = await this.dataSource.query(query, params);

      return {
        total_searches: result?.total_searches || 0,
        avg_results: result?.avg_results || 0,
        fallback_rate: result?.fallback_rate || 0,
      };

    } catch (error) {
      this.logger.error(`Error getting search stats: ${error.message}`, error.stack);
      return { total_searches: 0, avg_results: 0, fallback_rate: 0 };
    }
  }
}
