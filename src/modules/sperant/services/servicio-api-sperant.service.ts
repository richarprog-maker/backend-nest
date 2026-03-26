import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosRequestConfig, Method } from 'axios';

@Injectable()
export class ServicioApiSperantService {
    private readonly logger = new Logger(ServicioApiSperantService.name);

    constructor(private readonly configService: ConfigService) { }

    async crearCliente(codigoEmpresa: number, payload: Record<string, any>) {
        return this.request(codigoEmpresa, 'POST', '/clients', payload);
    }

    async crearEvento(codigoEmpresa: number, payload: Record<string, any>) {
        return this.request(codigoEmpresa, 'POST', '/events', payload);
    }

    async crearProforma(codigoEmpresa: number, payload: Record<string, any>) {
        return this.request(codigoEmpresa, 'POST', '/budgets', payload);
    }

    async buscarClientes(codigoEmpresa: number, q: string) {
        return this.request(codigoEmpresa, 'GET', '/clients', undefined, { q });
    }

    async listarTiposEvento(codigoEmpresa: number) {
        return this.request(codigoEmpresa, 'GET', '/event_types');
    }

    async listarUsuarios(codigoEmpresa: number) {
        return this.request(codigoEmpresa, 'GET', '/users');
    }

    private async request(
        codigoEmpresa: number,
        method: Method,
        path: string,
        payload?: Record<string, any>,
        params?: Record<string, any>,
    ) {
        const token = this.obtenerToken(codigoEmpresa);
        const baseUrl = this.obtenerBaseUrl();
        const timeout = Number(this.configService.get<string>('SPERANT_TIMEOUT_MS') || 12000);
        const retries = Number(this.configService.get<string>('SPERANT_RETRY_ATTEMPTS') || 3);
        const url = `${baseUrl}${path}`;
        const config: AxiosRequestConfig = {
            url,
            method,
            timeout,
            params,
            data: payload,
            headers: {
                Authentication: token,
                Authorization: token,
                'Content-Type': 'application/json',
            },
        };

        for (let intento = 1; intento <= retries; intento += 1) {
            try {
                const response = await axios.request(config);

                this.logger.log(
                    `[Sperant][HTTP] ${method} ${path} ok ${JSON.stringify({
                        codigoEmpresa,
                        intento,
                        params,
                        payload,
                    })}`,
                );

                return response.data;
            } catch (error) {
                const axiosError = error as AxiosError;
                const status = axiosError.response?.status;
                const reintentable = !status || status >= 500 || status === 429;
                const detalle = {
                    codigoEmpresa,
                    path,
                    intento,
                    status,
                    params,
                    data: axiosError.response?.data || axiosError.message,
                };

                this.logger.error(`[Sperant][HTTP] ${method} ${path} fallo ${JSON.stringify(detalle)}`);

                if (!reintentable || intento === retries) {
                    throw error;
                }

                await new Promise((resolve) => setTimeout(resolve, intento * 1000));
            }
        }
    }

    private obtenerToken(codigoEmpresa: number): string {
        const tokenPorEmpresa = this.configService.get<string>(`SPERANT_API_TOKEN_${codigoEmpresa}`);
        const token = tokenPorEmpresa
            || this.configService.get<string>(`SPERANT_API_KEY_${codigoEmpresa}`)
            || this.configService.get<string>('SPERANT_API_TOKEN')
            || this.configService.get<string>('SPERANT_API_KEY');

        if (!token) {
            throw new Error(`No existe SPERANT_API_TOKEN o SPERANT_API_KEY configurado para empresa ${codigoEmpresa}`);
        }

        return token;
    }

    private obtenerBaseUrl(): string {
        const baseUrlConfig = this.configService.get<string>('SPERANT_API_BASE_URL') || 'https://api.sperant.com/v3';
        const baseUrlNormalizada = baseUrlConfig.replace(/\/+$/, '');

        if (baseUrlNormalizada.endsWith('/v3')) {
            return baseUrlNormalizada;
        }

        return `${baseUrlNormalizada}/v3`;
    }
}
