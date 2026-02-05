import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CredencialesWapi } from './entities/credenciales-wapi.entity';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as FormData from 'form-data';

@Injectable()
export class WapiService {
    private readonly logger = new Logger(WapiService.name);
    private readonly algorithm = 'aes-256-cbc';

    constructor(
        @InjectRepository(CredencialesWapi)
        private credencialesRepo: Repository<CredencialesWapi>,
        private configService: ConfigService,
    ) { }

    private getEncryptionKey(): Buffer {
        const key = this.configService.get<string>('ENCRYPTION_KEY') || 'default_secret_key_32_chars_min_';
        return require('crypto').scryptSync(key, 'salt', 32);
    }

    private decrypt(text: string): string {
        try {
            const crypto = require('crypto');
            const textParts = text.split(':');
            if (textParts.length < 2) return text;
            const iv = Buffer.from(textParts.shift(), 'hex');
            const encryptedText = Buffer.from(textParts.join(':'), 'hex');
            const decipher = crypto.createDecipheriv(this.algorithm, this.getEncryptionKey(), iv);
            let decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString();
        } catch (error) {
            // No hacer nada si falla el typing
        }
    }

    // Método auxiliar para obtener el tipo MIME basado en la extensión del archivo
    private getMimeType(filename: string) {
        const ext = filename.toLowerCase().split('.').pop();
        const mimeTypes = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp',
            'pdf': 'application/pdf', 'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'txt': 'text/plain', 'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt': 'application/vnd.ms-powerpoint',
            'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'mp4': 'video/mp4', '3gp': 'video/3gpp',
            'mp3': 'audio/mpeg', 'aac': 'audio/aac', 'ogg': 'audio/ogg'
        };
        return mimeTypes[ext] || null;
    }

    // Subir archivo a WhatsApp
    async uploadMedia(codigoEmpresa: number, filePath: string, filename: string): Promise<string> {
        try {
            const { token, phoneId } = await this.getCredentials(codigoEmpresa);
            if (!token) throw new Error("No credentials");

            const url = `https://graph.facebook.com/v21.0/${phoneId}/media`;
            const fileBuffer = fs.readFileSync(filePath);
            const contentType = this.getMimeType(filename);

            if (!contentType) throw new Error(`Tipo MIME no soportado: ${filename}`);

            const form = new FormData();
            form.append('messaging_product', 'whatsapp');
            form.append('file', fileBuffer, { filename, contentType });

            const response = await axios.post(url, form, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    ...form.getHeaders()
                }
            });

            return response.data.id;
        } catch (error) {
            this.handleError(error);
            return null;
        }
    }

    async sendImage(codigoEmpresa: number, to: string, filePath: string, caption = '') {
        try {
            const mediaId = await this.uploadMedia(codigoEmpresa, filePath, filePath.split('/').pop());
            if (!mediaId) return;

            const { token, phoneId } = await this.getCredentials(codigoEmpresa);
            const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: to,
                type: 'image',
                image: { id: mediaId, caption: caption }
            };

            const response = await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });
            this.logger.log(`Imagen enviada a ${to}`);
            return response.data;
        } catch (error) {
            this.handleError(error);
            return { error: true, details: error.response?.data || error.message };
        }
    }

    /**
     * Envía una imagen por URL directa (sin necesidad de subir archivo)
     * WhatsApp API soporta enviar imágenes directamente por link
     */
    async sendImageByUrl(codigoEmpresa: number, to: string, imageUrl: string, caption = '') {
        try {
            const { token, phoneId } = await this.getCredentials(codigoEmpresa);
            const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: to,
                type: 'image',
                image: {
                    link: imageUrl,
                    caption: caption
                }
            };

            await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            this.logger.log(`Imagen por URL enviada a ${to}: ${imageUrl}`);
        } catch (error) {
            this.handleError(error);
            throw error;
        }
    }

    async sendDocument(codigoEmpresa: number, to: string, filePath: string, caption = '') {
        try {
            const filename = filePath.split('/').pop();
            const mediaId = await this.uploadMedia(codigoEmpresa, filePath, filename);
            if (!mediaId) return;

            const { token, phoneId } = await this.getCredentials(codigoEmpresa);
            const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: to,
                type: 'document',
                document: { id: mediaId, filename: filename, caption: caption }
            };

            const response = await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });
            this.logger.log(`Documento enviado a ${to}`);
            return response.data;
        } catch (error) {
            this.handleError(error);
            return { error: true, details: error.response?.data || error.message };
        }
    }

    async sendVideo(codigoEmpresa: number, to: string, filePath: string, caption = '') {
        try {
            const mediaId = await this.uploadMedia(codigoEmpresa, filePath, filePath.split('/').pop());
            if (!mediaId) return;

            const { token, phoneId } = await this.getCredentials(codigoEmpresa);
            const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: to,
                type: 'video',
                video: { id: mediaId, caption: caption }
            };

            const response = await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });
            this.logger.log(`Video enviado a ${to}`);
            return response.data;
        } catch (error) {
            this.handleError(error);
            return { error: true, details: error.response?.data || error.message };
        }
    }

    async sendAudio(codigoEmpresa: number, to: string, filePath: string) {
        try {
            const mediaId = await this.uploadMedia(codigoEmpresa, filePath, filePath.split('/').pop());
            if (!mediaId) return;

            const { token, phoneId } = await this.getCredentials(codigoEmpresa);
            const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: to,
                type: 'audio',
                audio: { id: mediaId }
            };

            const response = await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } });
            this.logger.log(`Audio enviado a ${to}`);
            return response.data;
        } catch (error) {
            this.handleError(error);
            return { error: true, details: error.response?.data || error.message };
        }
    }

    async sendMessage(codigoEmpresa: number, to: string, text: string) {
        try {
            // 1. Obtener credenciales
            const credencial = await this.credencialesRepo.findOne({ where: { codigoEmpresa } });
            if (!credencial) {
                this.logger.error(`No se encontraron credenciales WAPI para empresa ${codigoEmpresa}`);
                return;
            }

            const token = this.decrypt(credencial.wapiToken);
            const phoneId = credencial.wapiPhoneId;
            const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: to,
                text: { body: text },
                type: 'text'
            };

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            this.logger.log(`Mensaje enviado a ${to}: ${text.substring(0, 20)}...`);
            return response.data;

        } catch (error) {
            this.handleError(error);
            return {
                error: true,
                details: error.response?.data || error.message
            };
        }
    }

    async sendTemplate(codigoEmpresa: number, to: string, templateName: string, languageCode: string = 'es', components: any[] = []) {
        try {
            const { token, phoneId } = await this.getCredentials(codigoEmpresa);
            if (!token) return;

            const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: to,
                type: 'template',
                template: {
                    name: templateName,
                    language: {
                        code: languageCode
                    },
                    components: components
                }
            };

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            this.logger.log(`Template '${templateName}' enviado a ${to}`);
            return response.data;

        } catch (error) {
            this.handleError(error);
            return {
                error: true,
                details: error.response?.data || error.message
            };
        }
    }

    // Indica que se leyó el mensaje y simula "typing" (según legacy)
    async markAsReadAndTyping(codigoEmpresa: number, wamid: string) {
        try {
            const { token, phoneId } = await this.getCredentials(codigoEmpresa);
            if (!token) return;

            const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

            // Payload exacto del proyecto Legacy "checor"
            const payload = {
                "messaging_product": "whatsapp",
                "status": "read",
                "message_id": wamid,
                "typing_indicator": {
                    "type": "text"
                }
            };

            await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            this.logger.log(`Mark as Read sent for wamid: ${wamid}`);

        } catch (error) {
            this.handleError(error);
        }
    }

    // Método auxiliar para obtener credenciales y desencriptar
    private async getCredentials(codigoEmpresa: number) {
        const credencial = await this.credencialesRepo.findOne({ where: { codigoEmpresa } });
        if (!credencial) {
            this.logger.error(`No se encontraron credenciales WAPI para empresa ${codigoEmpresa}`);
            return { token: null, phoneId: null };
        }
        return {
            token: this.decrypt(credencial.wapiToken),
            phoneId: credencial.wapiPhoneId
        };
    }

    private handleError(error: any) {
        this.logger.error(`Error WAPI: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
    }
}
