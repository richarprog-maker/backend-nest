
// Scripts para probar manualmente la clasificación de tibios
// Ejecutar con ts-node o integrarlo temporalmente en el arranque
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { ClasificacionTibioTasksService } from './services/clasificacion-medio-alto-tasks.service';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const logger = new Logger('TestClasificacionTibio');

    try {
        logger.log('Iniciando contexto de aplicación para prueba...');
        const app = await NestFactory.createApplicationContext(AppModule);

        const service = app.get(ClasificacionTibioTasksService);

        logger.log('Ejecutando clasificación manual de leads tibios...');
        await service.clasificarLeadsTibios();

        logger.log('Prueba completada exitosamente.');
        await app.close();
        process.exit(0);
    } catch (error) {
        logger.error('Error en la prueba:', error);
        process.exit(1);
    }
}

bootstrap();
