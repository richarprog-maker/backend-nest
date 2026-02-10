
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Campania } from '../src/modules/campanias/entities/campania.entity';
import { CampaniaDetalle } from '../src/modules/campanias/entities/campania-detalle.entity';
import { Lead } from '../src/modules/inbox/entities/lead.entity';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);

    const campaniaRepo = app.get(getRepositoryToken(Campania));
    const detalleRepo = app.get(getRepositoryToken(CampaniaDetalle));
    const leadRepo = app.get(getRepositoryToken(Lead));
    const campaniasQueue = app.get<Queue>(getQueueToken('campanias'));

    // Hardcoded ID based on user context logs (Campaign #27 had errors)
    const campaniaId = 27;

    console.log(`Buscando TODOS los detalles para campaña ${campaniaId}...`);

    const detalles = await detalleRepo.find({
        where: { campaniaId },
        relations: ['campania', 'campania.plantilla']
    });

    console.log(`Encontrados ${detalles.length} detalles para campaña ${campaniaId}.`);
    detalles.forEach(d => console.log(`ID: ${d.id}, Estado: ${d.estado}, Tlf: ${d.telefono}`));

    // We want to resend those that failed OR those that are marked as 'enviado' but failed in webhook?
    // User said: "esa campaña con imagenes no me llego o o lego a los numeros que debdia de llegar"
    // So effectively we want to resend ALL of them for this specific campaign #27 because they all failed with media error logic.

    const aReenviar = detalles; // Resend ALL for this campaign 27.

    console.log(`Re-encolando ${aReenviar.length} mensajes...`);

    for (const detalle of aReenviar) {
        // Fetch Lead UUID if needed
        let leadUuid = null;
        if (detalle.leadId) {
            const lead = await leadRepo.findOne({ where: { id: detalle.leadId } });
            leadUuid = lead?.uuid;
        }

        const campania = detalle.campania;
        const usarTemplate = campania.plantilla?.metaStatus === 'APPROVED' && !!campania.plantilla?.nombre;

        const jobData = {
            detalleId: detalle.id,
            campaniaId: campania.id,
            plantillaCuerpo: campania.plantilla?.contenido,
            codigoEmpresa: campania.codigoEmpresa,
            usarTemplate: usarTemplate,
            templateName: campania.plantilla?.nombre,
            templateParams: campania.plantilla?.parametros,
            tipoMultimedia: detalle.tipoMultimedia,
            urlMultimedia: detalle.urlMultimedia,
            leadUuid: leadUuid
        };

        await campaniasQueue.add('enviar-mensaje', jobData, {
            removeOnComplete: true,
            removeOnFail: 50,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 }
        });

        console.log(`Re-encolado detalle ${detalle.id} -> ${detalle.telefono}`);
    }

    console.log('Proceso finalizado. Cerrando app...');
    await app.close();
}

bootstrap();
