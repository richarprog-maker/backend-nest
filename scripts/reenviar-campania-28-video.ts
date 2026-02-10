
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

    const campaniaId = 28;

    console.log(`Buscando detalles para campaña ${campaniaId}...`);

    const detalles = await detalleRepo.find({
        where: { campaniaId },
        relations: ['campania', 'campania.plantilla']
    });

    console.log(`Encontrados ${detalles.length} detalles para campaña ${campaniaId}.`);

    // Update details to 'video' just in case they are still 'imagen' in DB
    // User said they corrected it in DB, but let's be sure these specific rows are correct.
    for (const d of detalles) {
        if (d.tipoMultimedia !== 'video') {
            console.log(`Corrigiendo tipoMultimedia de ${d.id} a 'video' (era '${d.tipoMultimedia}')`);
            d.tipoMultimedia = 'video';
            await detalleRepo.save(d);
        }
    }

    const aReenviar = detalles;

    console.log(`Re-encolando ${aReenviar.length} mensajes como VIDEO...`);

    for (const detalle of aReenviar) {
        let leadUuid = null;
        if (detalle.leadId) {
            const lead = await leadRepo.findOne({ where: { id: detalle.leadId } });
            leadUuid = lead?.uuid;
        }

        const campania = detalle.campania;
        // Note: If the template was corrected to 'video', we can use it. 
        // But we will populate jobData explicitly with 'video' to be safe.

        const jobData = {
            detalleId: detalle.id,
            campaniaId: campania.id,
            plantillaCuerpo: campania.plantilla?.contenido,
            codigoEmpresa: campania.codigoEmpresa,
            // FORCE NO TEMPLATE: The template was created as IMAGE in Meta, so we can't send VIDEO with it.
            // We must send as a direct video message.
            usarTemplate: false, // campania.plantilla?.metaStatus === 'APPROVED' && !!campania.plantilla?.nombre,
            templateName: campania.plantilla?.nombre,
            templateParams: campania.plantilla?.parametros,

            // FORCE VIDEO TYPE
            tipoMultimedia: 'video',
            urlMultimedia: detalle.urlMultimedia, // Should be the mp4 path

            leadUuid: leadUuid
        };

        await campaniasQueue.add('enviar-mensaje', jobData, {
            removeOnComplete: true,
            removeOnFail: 50,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 }
        });

        console.log(`Re-encolado detalle ${detalle.id} -> ${detalle.telefono} (Multimedia: ${jobData.tipoMultimedia})`);
    }

    console.log('Proceso finalizado. Cerrando app...');
    await app.close();
}

bootstrap();
