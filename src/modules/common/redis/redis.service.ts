import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private redisClient: Redis;

    constructor(private configService: ConfigService) { }

    onModuleInit() {
        this.redisClient = new Redis({
            host: this.configService.get<string>('REDIS_HOST', 'localhost'),
            port: this.configService.get<number>('REDIS_PORT', 6379),
        });
    }

    onModuleDestroy() {
        this.redisClient.disconnect();
    }

    async pauseChat(leadUuid: string): Promise<void> {
        await this.redisClient.set(`bot_pause:${leadUuid}`, 'true');
    }

    async unpauseChat(leadUuid: string): Promise<void> {
        await this.redisClient.del(`bot_pause:${leadUuid}`);
    }

    async isPaused(leadUuid: string): Promise<boolean> {
        const result = await this.redisClient.get(`bot_pause:${leadUuid}`);
        return result === 'true';
    }

    async appendMessageToBuffer(leadUuid: string, message: string): Promise<void> {
        await this.redisClient.rpush(`buffer_ai_messages:${leadUuid}`, message);
        // Expiración de seguridad de 1 hora por si algo falla y no se procesa
        await this.redisClient.expire(`buffer_ai_messages:${leadUuid}`, 3600);
    }

    async getAndClearBuffer(leadUuid: string): Promise<string[]> {
        const key = `buffer_ai_messages:${leadUuid}`;
        // Usar MULTI/EXEC para operación atómica
        const pipeline = this.redisClient.multi();
        pipeline.lrange(key, 0, -1);
        pipeline.del(key);
        const results = await pipeline.exec();
        
        // results[0] = [error, mensajes], results[1] = [error, delResult]
        if (results && results[0] && !results[0][0]) {
            return results[0][1] as string[];
        }
        return [];
    }

    /**
     * Obtiene la cantidad de mensajes en el buffer sin borrarlos
     */
    async getBufferLength(leadUuid: string): Promise<number> {
        const key = `buffer_ai_messages:${leadUuid}`;
        return await this.redisClient.llen(key);
    }

    /**
     * Intenta adquirir un lock para procesar mensajes de un lead.
     * Evita ejecuciones simultáneas del agente para el MISMO lead.
     * Diferentes leads pueden procesarse en paralelo sin problemas.
     * @returns true si se adquirió el lock, false si ya está procesando
     */
    async acquireProcessingLock(leadUuid: string, ttlSeconds: number = 120): Promise<boolean> {
        const key = `processing_lock:${leadUuid}`;
        // SET NX (solo si no existe) con expiración - operación atómica
        const result = await this.redisClient.set(key, Date.now().toString(), 'EX', ttlSeconds, 'NX');
        return result === 'OK';
    }

    /**
     * Libera el lock de procesamiento
     */
    async releaseProcessingLock(leadUuid: string): Promise<void> {
        await this.redisClient.del(`processing_lock:${leadUuid}`);
    }

    /**
     * Verifica si hay un procesamiento activo para un lead específico
     */
    async isProcessing(leadUuid: string): Promise<boolean> {
        const result = await this.redisClient.get(`processing_lock:${leadUuid}`);
        return result !== null;
    }

    /**
     * Programa un timeout distribuido usando Redis (para múltiples instancias)
     * Retorna true si este proceso debe ejecutar el callback
     */
    async scheduleDistributedTimeout(leadUuid: string, delaySeconds: number): Promise<boolean> {
        const key = `scheduled_process:${leadUuid}`;
        const timestamp = Date.now() + (delaySeconds * 1000);
        
        // Solo guarda si no existe o si el nuevo timestamp es mayor
        const current = await this.redisClient.get(key);
        if (current) {
            // Ya hay un timeout programado, actualizar timestamp
            await this.redisClient.set(key, timestamp.toString(), 'EX', delaySeconds + 5);
            return false; // No ejecutar, ya hay otro esperando
        }
        
        await this.redisClient.set(key, timestamp.toString(), 'EX', delaySeconds + 5, 'NX');
        return true;
    }

    /**
     * Marca que se va a procesar y limpia el schedule
     */
    async claimScheduledProcess(leadUuid: string): Promise<boolean> {
        const key = `scheduled_process:${leadUuid}`;
        const result = await this.redisClient.del(key);
        return result > 0;
    }
}
