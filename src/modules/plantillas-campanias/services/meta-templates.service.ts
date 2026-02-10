import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlantillaCampania } from '../entities/plantilla-campania.entity';
import { CredencialesWapi } from '../../webhook_meta/entities/credenciales-wapi.entity';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as FormData from 'form-data';
import * as mime from 'mime-types';

@Injectable()
export class MetaTemplatesService {
    private readonly logger = new Logger(MetaTemplatesService.name);
    private readonly graphApiUrl: string;

    constructor(
        @InjectRepository(PlantillaCampania)
        private plantillaRepo: Repository<PlantillaCampania>,
        @InjectRepository(CredencialesWapi)
        private credencialesRepo: Repository<CredencialesWapi>,
        private configService: ConfigService,
    ) {
        this.graphApiUrl = this.configService.get<string>('FACEBOOK_GRAPH_API_URL') || 'https://graph.facebook.com/v24.0';
    }

    private async getCredentials(codigoEmpresa: number) {
        const creds = await this.credencialesRepo.findOne({ where: { codigoEmpresa, estado: 1 } });
        if (!creds) {
            throw new Error(`No se encontraron credenciales para empresa ${codigoEmpresa}`);
        }
        return creds;
    }

    private normalizeTemplateName(nombre: string): string {
        return nombre
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .substring(0, 512);
    }

    private async uploadMediaForTemplate(
        filePath: string,
        appId: string,
        accessToken: string
    ): Promise<string> {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Archivo no encontrado: ${filePath}`);
        }

        const fileBuffer = fs.readFileSync(filePath);
        const filename = path.basename(filePath);
        const contentType = mime.lookup(filePath) || 'application/octet-stream';

        this.logger.log(`Subiendo archivo: ${filename} (${fileBuffer.length} bytes) via Resumable Upload API, App ID: ${appId}`);

        const sessionUrl = `${this.graphApiUrl}/${appId}/uploads`;
        const sessionResponse = await axios.post(
            sessionUrl,
            { file_length: fileBuffer.length, file_type: contentType, file_name: filename },
            { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );

        const uploadSessionId = sessionResponse.data.id;
        const uploadUrl = `${this.graphApiUrl}/${uploadSessionId}`;
        const form = new FormData();
        form.append('file', fileBuffer, { filename, contentType });

        const uploadResponse = await axios.post(uploadUrl, form, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'file_offset': '0', ...form.getHeaders() }
        });

        this.logger.log(`Archivo subido. Handle: ${uploadResponse.data.h}`);
        return uploadResponse.data.h;
    }

    async crearPlantillaEnMeta(
        plantillaId: number,
        codigoEmpresa: number
    ): Promise<{ success: boolean; metaId?: string; status?: string; error?: string }> {
        try {
            const plantilla = await this.plantillaRepo.findOne({ where: { id: plantillaId } });
            if (!plantilla) {
                return { success: false, error: 'Plantilla no encontrada' };
            }

            const creds = await this.getCredentials(codigoEmpresa);
            if (!creds.wapiBusinessId) {
                return { success: false, error: 'WABA ID no configurado en credenciales' };
            }

            const wabaName = this.normalizeTemplateName(plantilla.nombre);
            const url = `${this.graphApiUrl}/${creds.wapiBusinessId}/message_templates`;

            const components = [];

            if (plantilla.tipo_contenido_multimedia &&
                plantilla.tipo_contenido_multimedia !== 'ninguno' &&
                plantilla.url_multimedia) {

                let headerFormat = 'TEXT';

                switch (plantilla.tipo_contenido_multimedia.toLowerCase()) {
                    case 'imagen':
                    case 'image':
                        headerFormat = 'IMAGE';
                        break;
                    case 'video':
                        headerFormat = 'VIDEO';
                        break;
                    case 'documento':
                    case 'document':
                        headerFormat = 'DOCUMENT';
                        break;
                }

                if (headerFormat !== 'TEXT') {
                    const fullPath = plantilla.url_multimedia.startsWith('/')
                        ? path.join(process.cwd(), plantilla.url_multimedia)
                        : path.join(process.cwd(), 'public', plantilla.url_multimedia);

                    const mediaHandle = await this.uploadMediaForTemplate(fullPath, creds.appId, creds.wapiToken);

                    components.push({
                        type: 'HEADER',
                        format: headerFormat,
                        example: { header_handle: [mediaHandle] }
                    });
                }
            }

            const bodyComponent: any = {
                type: 'BODY',
                text: plantilla.contenido
            };

            // Agregar ejemplos si hay parámetros
            if (plantilla.parametros && plantilla.parametros.length > 0) {
                const ejemplos = plantilla.parametros.map((p, i) => `Ejemplo${i + 1}`);
                bodyComponent.example = {
                    body_text: [ejemplos]
                };
            }
            components.push(bodyComponent);

            const requestBody = {
                name: wabaName,
                language: plantilla.idioma || 'es_PE',
                category: 'MARKETING',
                components: components
            };

            this.logger.log(`Creando plantilla en Meta: ${wabaName}`);
            this.logger.log(`Payload: ${JSON.stringify(requestBody, null, 2)}`);

            const response = await axios.post(url, requestBody, {
                headers: {
                    'Authorization': `Bearer ${creds.wapiToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const metaId = response.data.id;
            const status = response.data.status || 'PENDING';

            // Actualizar plantilla local
            await this.plantillaRepo.update(plantillaId, {
                metaTemplateId: metaId,
                metaStatus: status,
                metaError: null,
                metaSyncedAt: new Date()
            });

            this.logger.log(`Plantilla creada en Meta. ID: ${metaId}, Estado: ${status}`);

            return { success: true, metaId, status };

        } catch (error) {
            const errorMessage = error.response?.data?.error?.message || error.message;
            const errorCode = error.response?.data?.error?.code;
            const errorSubcode = error.response?.data?.error?.error_subcode;

            this.logger.error(`Error creando plantilla en Meta: ${errorMessage}`);
            if (error.response?.data) {
                this.logger.error(`Detalles del error: ${JSON.stringify(error.response.data, null, 2)}`);
            }

            let userError = errorMessage;
            if (errorCode === 100 && errorSubcode === 2388023) {
                userError = 'El nombre de la plantilla ya existe o fue usado recientemente. Intenta otro nombre.';
            } else if (errorMessage.includes('duplicate')) {
                userError = 'Ya existe una plantilla con este nombre en Meta.';
            }

            // Guardar error en BD
            await this.plantillaRepo.update(plantillaId, {
                metaStatus: 'REJECTED',
                metaError: userError
            });

            return { success: false, error: userError };
        }
    }

    async obtenerEstadoPlantilla(plantillaId: number, codigoEmpresa: number): Promise<string> {
        try {
            const plantilla = await this.plantillaRepo.findOne({ where: { id: plantillaId } });
            if (!plantilla || !plantilla.metaTemplateId) {
                return 'LOCAL';
            }

            const creds = await this.getCredentials(codigoEmpresa);
            const url = `${this.graphApiUrl}/${plantilla.metaTemplateId}`;

            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${creds.wapiToken}` }
            });

            const status = response.data.status || 'PENDING';

            // Actualizar en BD
            await this.plantillaRepo.update(plantillaId, {
                metaStatus: status,
                metaSyncedAt: new Date()
            });

            return status;

        } catch (error) {
            this.logger.error(`Error obteniendo estado: ${error.message}`);
            return 'ERROR';
        }
    }

    async listarPlantillasMeta(codigoEmpresa: number): Promise<any[]> {
        try {
            const creds = await this.getCredentials(codigoEmpresa);
            if (!creds.wapiBusinessId) {
                return [];
            }

            const url = `${this.graphApiUrl}/${creds.wapiBusinessId}/message_templates`;

            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${creds.wapiToken}` }
            });

            return response.data.data || [];

        } catch (error) {
            this.logger.error(`Error listando plantillas Meta: ${error.message}`);
            if (error.response) {
                this.logger.error(`Detalles error Meta: ${JSON.stringify(error.response.data)}`);
                this.logger.error(`URL intentada: ${this.graphApiUrl}/${(await this.getCredentials(codigoEmpresa)).wapiBusinessId}/message_templates`);
            }
            return [];
        }
    }

    async sincronizarPlantillas(codigoEmpresa: number): Promise<{ actualizadas: number }> {
        const plantillasMeta = await this.listarPlantillasMeta(codigoEmpresa);
        let actualizadas = 0;

        for (const metaTemplate of plantillasMeta) {
            const plantillaLocal = await this.plantillaRepo.findOne({
                where: { metaTemplateId: metaTemplate.id, codigo_empresa: codigoEmpresa }
            });

            if (plantillaLocal) {
                await this.plantillaRepo.update(plantillaLocal.id, {
                    metaStatus: metaTemplate.status,
                    metaTemplateId: metaTemplate.id,
                    metaSyncedAt: new Date()
                });
                actualizadas++;
            }
        }

        return { actualizadas };
    }
}
