import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        cors: true,
    });

    // Configuración de archivos estáticos
    // Usar process.cwd() para que funcione tanto en desarrollo (ts-node) como producción (dist)
    app.useStaticAssets(join(process.cwd(), 'storage'), {
        prefix: '/storage/',
    });

    // Configuración Global de Pipes
    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));

    // Configuración Swagger
    const config = new DocumentBuilder()
        .setTitle('Checo')
        .setDescription('Backend de checor')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    // Configurar prefijo global 
    app.setGlobalPrefix('api');

    // CORS mejorado para WebSocket
    app.enableCors({
        origin: true,
        credentials: true,
    });

    const port = process.env.PORT || 3007;

    if (process.env.IS_TASK_WORKER === 'true') {
        await app.init();
        console.log('Task worker started');
    } else {
        await app.listen(port);
        console.log(`Application is running on: http://localhost:${port}`);
    }
}
bootstrap();
