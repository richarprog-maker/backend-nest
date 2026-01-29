import { Injectable, Logger } from '@nestjs/common';

export interface PropertyUnit {
  id: number;
  id_proyecto: number;
  unidad: string;
  tipo_unidad: string;
  tipologia: string;
  nro_piso: number;
  nro_dormitorios: number;
  vista: string;
  area_total: number;
  area_techada: number;
  area_libre: number;
  precio_lista: number;
  moneda_lista: string;
  precio_promocion: number;
  fecha_fin_promocion: string;
  disponibilidad: string;
  url_plano: string;
  url_ubicacion: string;
  url_plano_2: string;
  features_json: any;
  nombre_proyecto: string;
  proyecto_tipo_inmueble: string;
  proyecto_ubicacion: string;
}

export interface PropertyDocument {
  pageContent: string;
  metadata: PropertyMetadata;
}

export interface PropertyMetadata {
  id_mysql: number;
  project_name: string;
  unit_number: string;
  unit_type: string;
  typology: string;
  floor: number;
  bedrooms: number;
  view: string;
  area_total: number;
  area_techada: number;
  area_libre: number;
  price_list: number;
  price_promo: number;
  currency: string;
  availability: string;
  promo_end_date: string;
  url_floor_plan: string;
  url_location: string;
  url_floor_plan_2: string;
  project_location: string;
  features: string;
  text_complete: string;
}

@Injectable()
export class PropertyEmbeddingStrategy {
  private readonly logger = new Logger(PropertyEmbeddingStrategy.name);

  generateDocumentForProperty(unit: PropertyUnit): PropertyDocument {
    const textComplete = this.generateCompleteText(unit);

    const pageContent = textComplete;

    const metadata: PropertyMetadata = {
      id_mysql: unit.id,
      project_name: unit.nombre_proyecto || '',
      unit_number: unit.unidad || '',
      unit_type: unit.tipo_unidad || unit.proyecto_tipo_inmueble || '',
      typology: unit.tipologia || '',
      floor: unit.nro_piso || 0,
      bedrooms: unit.nro_dormitorios || 0,
      view: unit.vista?.toLowerCase() || '',
      area_total: unit.area_total || 0,
      area_techada: unit.area_techada || 0,
      area_libre: unit.area_libre || 0,
      price_list: unit.precio_lista || 0,
      price_promo: unit.precio_promocion || 0,
      currency: unit.moneda_lista || 'soles',
      availability: unit.disponibilidad?.toLowerCase() || '',
      promo_end_date: unit.fecha_fin_promocion || '',
      url_floor_plan: unit.url_plano || '',
      url_location: unit.url_ubicacion || '',
      url_floor_plan_2: unit.url_plano_2 || '',
      project_location: unit.proyecto_ubicacion || '',
      features: this.serializeFeatures(unit.features_json),
      text_complete: textComplete,
    };

    return {
      pageContent,
      metadata,
    };
  }

  private generateCompleteText(unit: PropertyUnit): string {
    const tipoInmueble = unit.tipo_unidad || unit.proyecto_tipo_inmueble || 'Departamento';
    const dormitorios = unit.nro_dormitorios || 0;
    const dormitoriosText = dormitorios === 0 ? 'Monoambiente' : `${dormitorios} ${dormitorios === 1 ? 'dormitorio' : 'dormitorios'}`;
    const area = unit.area_total || 0;
    const precio = unit.precio_lista || 0;
    const moneda = unit.moneda_lista === 'soles' ? 'S/' : 'USD';
    const precioPromo = unit.precio_promocion || 0;
    const tipologia = unit.tipologia || '';
    const piso = unit.nro_piso || 0;
    const vista = unit.vista || '';

    let text = `${tipoInmueble} unidad ${unit.unidad}`;
    
    if (tipologia) {
      text += `, tipología ${tipologia}`;
    }
    
    text += `. Piso ${piso}, ${dormitoriosText}`;
    
    if (vista) {
      text += `, vista ${vista}`;
    }
    
    text += `. Área total ${area} m2`;
    
    if (unit.area_techada && unit.area_techada > 0) {
      text += `, área techada ${unit.area_techada} m2`;
    }
    
    if (unit.area_libre && unit.area_libre > 0) {
      text += `, área libre ${unit.area_libre} m2`;
    }
    
    text += `. Precio ${moneda} ${precio.toLocaleString('es-PE')}`;
    
    if (precioPromo && precioPromo < precio) {
      text += `, precio promoción ${moneda} ${precioPromo.toLocaleString('es-PE')}`;
      if (unit.fecha_fin_promocion) {
        text += ` hasta ${unit.fecha_fin_promocion}`;
      }
    }
    
    text += '.';

    return text;
  }

  private serializeFeatures(features: any): string {
    if (!features) return '';
    
    try {
      if (typeof features === 'string') {
        return features;
      }
      return JSON.stringify(features);
    } catch (error) {
      this.logger.warn(`Failed to serialize features: ${error.message}`);
      return '';
    }
  }
}
