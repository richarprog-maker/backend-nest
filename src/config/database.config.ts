import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const databaseConfig = (configService: ConfigService): TypeOrmModuleOptions => {
    return {
        type: 'mysql',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USER', 'root'),
        password: configService.get<string>('DB_PASS', 'richar12#'),
        database: configService.get<string>('DB_NAME', 'db_autom_inkav2'),
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        synchronize: false, // ¡IMPORTANTE! False para no alterar tablas existentes por error
        logging: false, // desactivamos  para no ver logs de mysql
        timezone: '-05:00',
    };
};
