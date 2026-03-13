import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

@Injectable()
export class ServicioApiSperantService {
    private readonly logger = new Logger(ServicioApiSperantService.name);

    constructor(private readonly configService: ConfigService) { }

    async crearCliente(codigoEmpresa: number, payload: Record<string, any>) {
        return this.post(codigoEmpresa, '/v3/clients', payload);
    }

    async crearEvento(codigoEmpresa: number, payload: Record<string, any>) {
        return this.post(codigoEmpresa, '/v3/events', payload);
    }

    async crearProforma(codigoEmpresa: number, payload: Record<string, any>) {
        return this.post(codigoEmpresa, '/v3/budgets', payload);
    }

    private async post(codigoEmpresa: number, path: string, payload: Record<string, any>) {
        const token = this.obtenerToken(codigoEmpresa);
        const baseUrl = this.configService.get<string>('SPERANT_API_BASE_URL') || 'https://api.sperant.com';
        const timeout = Number(this.configService.get<string>('SPERANT_TIMEOUT_MS') || 12000);
        const url = `${baseUrl}${path}`;

        try {
            const response = await axios.post(url, payload, {
                timeout,
                headers: {
                    Authentication: token,
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            this.logger.log(
                `[Sperant][HTTP] POST ${path} ok ${JSON.stringify({
                    codigoEmpresa,
                    url,
                })}`,
            );

            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            const detalle = {
                codigoEmpresa,
                path,
                status: axiosError.response?.status,
                data: axiosError.response?.data || axiosError.message,
            };

            this.logger.error(`[Sperant][HTTP] POST ${path} fallo ${JSON.stringify(detalle)}`);
            throw error;
        }
    }

    private obtenerToken(codigoEmpresa: number): string {
        const tokenPorEmpresa = this.configService.get<string>(`SPERANT_API_TOKEN_${codigoEmpresa}`);
        const token = tokenPorEmpresa || this.configService.get<string>('SPERANT_API_TOKEN');

        if (!token) {
            throw new Error(`No existe SPERANT_API_TOKEN configurado para empresa ${codigoEmpresa}`);
        }

        return token;
    }
}
