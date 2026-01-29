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
        // Obtener todos los elementos
        const messages = await this.redisClient.lrange(key, 0, -1);
        // Borrar la lista una vez obtenida (Atomicidad ideal requeriría MULTI/EXEC o LUA, pero para este uso GET+DEL es aceptable)
        await this.redisClient.del(key);
        return messages;
    }
}
