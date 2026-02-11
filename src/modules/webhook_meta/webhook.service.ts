import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { CredencialesWapi } from './entities/credenciales-wapi.entity';
import { Mensaje } from '../inbox/entities/mensaje.entity';
import { Lead } from '../inbox/entities/lead.entity';
import { Prospecto } from '../inbox/entities/prospecto.entity';
import { AiService } from '../ia/ia.service';
import { WapiService } from './wapi.service';
import { SmartSplitService } from '../ia/smart-split.service';
import { InboxGateway } from '../inbox/inbox.gateway';
import { RedisService } from '../common/redis/redis.service';

@Injectable()
export class WebhookService implements OnModuleInit {
    private readonly logger = new Logger(WebhookService.name);

    constructor(
        private configService: ConfigService,
        @InjectRepository(CredencialesWapi)
        private credencialesRepo: Repository<CredencialesWapi>,
        @InjectRepository(Mensaje)
        private mensajeRepo: Repository<Mensaje>,
        @InjectRepository(Lead)
        private leadRepo: Repository<Lead>,
        @InjectRepository(Prospecto)
        private prospectoRepo: Repository<Prospecto>,
        private aiService: AiService,
        private wapiService: WapiService,
        private smartSplitService: SmartSplitService,
        @Inject(forwardRef(() => InboxGateway))
        private inboxGateway: InboxGateway,
        private redisService: RedisService,
    ) { }

    async onModuleInit() {
        await this.syncCredentialsFromEnv();
    }

    private async syncCredentialsFromEnv() {
        try {
            const token = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
            const phoneId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
            // Soporte para ambas variables de entorno
            const businessId = this.configService.get<string>('WHATSAPP_BUSINESS_ID') ||
                this.configService.get<string>('META_BUSINESS_ACCOUNT_ID');
            const appId = this.configService.get<string>('META_APP_ID');
            const verifyToken = this.configService.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
            const codigoEmpresa = 1; // Default para MVP

            if (!token || !phoneId) {
                this.logger.warn('Credenciales de Meta no encontradas en .env. Saltando sincronización.');
                return;
            }

            // Buscar si ya existen credenciales para la empresa 1
            const credenciales = await this.credencialesRepo.find({ where: { codigoEmpresa } });

            let credencial: CredencialesWapi;

            if (credenciales.length > 0) {
                // Tomar el primero
                credencial = credenciales[0];

                // Si hay duplicados, borrarlos
                if (credenciales.length > 1) {
                    const duplicados = credenciales.slice(1);
                    const ids = duplicados.map(c => c.id);
                    await this.credencialesRepo.delete(ids);
                    this.logger.warn(`⚠️ Se encontraron y eliminaron ${ids.length} credenciales duplicadas para empresa ${codigoEmpresa}.`);
                }
            } else {
                credencial = this.credencialesRepo.create({ codigoEmpresa });
            }

            // Actualizar siempre con lo que hay en el .env
            credencial.wapiToken = token;
            credencial.wapiPhoneId = phoneId;
            credencial.wapiBusinessId = businessId;
            credencial.appId = appId;
            credencial.verifyToken = verifyToken;
            credencial.estado = 1;

            await this.credencialesRepo.save(credencial);
            this.logger.log('Credenciales WAPI sincronizadas desde .env exitosamente.');

        } catch (error) {
            this.logger.error(`Error sincronizando credenciales WAPI: ${error.message}`);
        }
    }

    verifyWebhook(mode: string, token: string, challenge: string): string {
        const verifyToken = this.configService.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');

        if (mode === 'subscribe' && token === verifyToken) {
            this.logger.log('Webhook verificado correctamente');
            return challenge;
        }

        this.logger.warn(`Fallo verificacion Webhook: Token enviado '${token}' no coincide con env.`);
        return null;
    }

    async processIncomingMessage(codigoEmpresa: number, body: any) {
        try {
            if (body.object === 'whatsapp_business_account') {
                const entry = body.entry?.[0];
                const changes = entry?.changes?.[0];
                const value = changes?.value;

                // Procesar Mensajes Entrantes
                if (value?.messages) {
                    const message = value.messages[0];
                    const contact = value.contacts?.[0];

                    await this.handleIncomingMessage(codigoEmpresa, message, contact);
                }

                // Procesar Estados (Sent, Delivered, Read)
                if (value?.statuses) {
                    const status = value.statuses[0];
                    await this.handleStatusUpdate(status);
                }
            }
        } catch (error) {
            this.logger.error(`Error procesando mensaje webhook: ${error.message}`, error.stack);
        }
    }


    // Mapa para controlar los timeouts de debounce por lead
    private timeouts = new Map<string, NodeJS.Timeout>();

    private async handleIncomingMessage(codigoEmpresa: number, message: any, contact: any) {
        const waId = contact?.wa_id;
        const from = message.from;
        const type = message.type;
        const body = message.text?.body || message.button?.text || '[Multimedia]';
        const timestamp = new Date(parseInt(message.timestamp) * 1000);

        this.logger.log(`Mensaje recibido de ${from}: ${body}`);

        // 1. Buscar o Crear Lead (Identidad)
        let lead = await this.leadRepo.findOne({
            where: { telefono: from } // Ahora buscamos en tbl_leads por teléfono único
        });

        if (!lead) {
            // Crear nuevo Lead
            lead = this.leadRepo.create({
                codigoEmpresa,
                telefono: from,
                nombreMeta: contact?.profile?.name || null,
                // nombre queda vacío hasta que el cliente diga su nombre real
                // UUID se genera automáticamente en la entidad
                fechaRegistro: new Date(),
            });
            await this.leadRepo.save(lead);
            this.logger.log(`Nuevo Lead creado: ${lead.uuid}`);

            // Opcional: Crear un Prospecto "Orgánico" por defecto para este Lead
            const nuevoProspecto = this.prospectoRepo.create({
                idLead: lead.id,
                codigoEmpresa,
                origenDato: 'WhatsApp Inbound',
                origenId: 3,
                estadoGestion: 'nuevo',
                fechaRegistro: new Date()
            });
            await this.prospectoRepo.save(nuevoProspecto);
        }

        // 2. Guardar Mensaje en BD
        const nuevoMensaje = this.mensajeRepo.create({
            codigoEmpresa,
            leadUuid: lead.uuid, // Vinculamos al Lead
            idEmisorTipo: 1, // 1 = Lead/Cliente
            contenido: body,
            numeroTelefono: from,
            fechaRecibido: new Date(),
            fechaCreacion: new Date(),
            tipoMultimedia: type !== 'text' ? type : null,
            wamidMsg: message.id,
            leido: 0
        });

        await this.mensajeRepo.save(nuevoMensaje);
        this.logger.log(`Mensaje guardado ID: ${nuevoMensaje.id}`);

        // Notificar mensaje nuevo en tiempo real
        this.inboxGateway.notifyNewMessage(codigoEmpresa, lead.uuid, {
            tipo: 'mensaje',
            id: nuevoMensaje.id,
            contenido: nuevoMensaje.contenido,
            fechaCreacion: nuevoMensaje.fechaCreacion,
            fechaRecibido: nuevoMensaje.fechaRecibido,
            idEmisorTipo: nuevoMensaje.idEmisorTipo,
            tipoEmisor: 'Prospecto',
            urlMultimedia: nuevoMensaje.urlMultimedia,
            tipoMultimedia: nuevoMensaje.tipoMultimedia,
            estadoMensaje: nuevoMensaje.estadoMensaje,
            leido: nuevoMensaje.leido,
        });

        // Notificar actualización de conversaciones (para que aparezcan nuevos leads)
        this.inboxGateway.notifyConversationsUpdate(codigoEmpresa);

        // 3. Enviar "Escribiendo..." / Marcar Leído (Legacy Style)
        await this.wapiService.markAsReadAndTyping(codigoEmpresa, message.id);

        // ============================================================
        // LÓGICA DE BUFFERING (REDIS + DEBOUNCE)
        // ============================================================

        // Agregar mensaje actual al buffer de Redis
        await this.redisService.appendMessageToBuffer(lead.uuid, body);

        // Configuración de tiempo de espera
        const bufferSeconds = parseInt(this.configService.get<string>('MESSAGE_BUFFER_SECONDS', '5'));
        const delayMs = bufferSeconds * 1000;

        // Limpiar timeout anterior si existe (Reiniciar el contador - Debounce)
        if (this.timeouts.has(lead.uuid)) {
            clearTimeout(this.timeouts.get(lead.uuid));
            this.logger.debug(`Reiniciando buffer timer para Lead: ${lead.uuid}`);
        }

        // Configurar nuevo timeout
        const timeoutId = setTimeout(async () => {
            await this.procesarBuffer(lead.uuid, codigoEmpresa, from, bufferSeconds);
        }, delayMs);

        // Guardar referencia del timeout
        this.timeouts.set(lead.uuid, timeoutId);
    }

    // Mapa para saber si un lead está siendo procesado actualmente
    private procesandoLead = new Set<string>();

    /**
     * Procesa el buffer de mensajes.
     * Si llegan más mensajes mientras procesa, se agregan al buffer y se procesan después.
     * NO usa locks ni reintentos - solo acumula mensajes.
     */
    private async procesarBuffer(
        leadUuid: string,
        codigoEmpresa: number,
        from: string,
        bufferSeconds: number
    ) {
        this.logger.log(`Procesando buffer de mensajes para Lead: ${leadUuid} tras ${bufferSeconds}s de silencio.`);
        this.timeouts.delete(leadUuid); // Limpiar referencia local

        // Si ya está procesando este lead, los mensajes se acumularán en el buffer
        // y se procesarán cuando termine el ciclo actual
        if (this.procesandoLead.has(leadUuid)) {
            this.logger.log(`Lead ${leadUuid} ya está siendo procesado. Los mensajes se acumularán en el buffer.`);
            return;
        }

        // Marcar que estamos procesando este lead
        this.procesandoLead.add(leadUuid);

        try {
            // Loop: mientras haya mensajes en el buffer, procesarlos
            let continuar = true;
            while (continuar) {
                // Recuperar y limpiar buffer desde Redis (atómico)
                const mensajesBuffered = await this.redisService.getAndClearBuffer(leadUuid);

                if (!mensajesBuffered || mensajesBuffered.length === 0) {
                    continuar = false;
                    break;
                }

                // Unir todos los mensajes como uno solo
                const mensajeUnificado = mensajesBuffered.join('\n');
                this.logger.log(`Mensaje unificado para IA (${mensajesBuffered.length} msgs): "${mensajeUnificado}"`);

                // Generar Respuesta con IA
                const historial = [];

                const respuestaIA = await this.aiService.generarRespuesta(
                    mensajeUnificado,
                    historial,
                    codigoEmpresa,
                    leadUuid,
                    from
                );

                this.logger.log(`Respuesta IA generada: ${respuestaIA}`);

                if (!respuestaIA) {
                    this.logger.log('Bot pausado o sin respuesta. No se enviará mensaje.');
                    // Verificar si llegaron más mensajes mientras procesábamos
                    const hayMas = await this.redisService.getBufferLength(leadUuid);
                    continuar = hayMas > 0;
                    continue;
                }

                // Enviar respuesta (código existente)
                await this.enviarRespuestaIA(respuestaIA, codigoEmpresa, leadUuid, from);

                // Verificar si llegaron más mensajes mientras procesábamos
                const hayMasMensajes = await this.redisService.getBufferLength(leadUuid);
                if (hayMasMensajes > 0) {
                    this.logger.log(`Hay ${hayMasMensajes} mensajes nuevos en buffer. Procesando...`);
                    continuar = true;
                } else {
                    continuar = false;
                }
            }

        } catch (error) {
            this.logger.error(`Error procesando buffer IA para lead ${leadUuid}: ${error.message}`);
        } finally {
            // Liberar el lead para futuros procesamientos
            this.procesandoLead.delete(leadUuid);
        }
    }

    /**
     * Envía la respuesta de IA al usuario
     */
    private async enviarRespuestaIA(
        respuestaIA: string,
        codigoEmpresa: number,
        leadUuid: string,
        from: string
    ) {
        // Smart Split & Envío
        const mensajesSplit = await this.smartSplitService.splitMessage(respuestaIA);

        let conversacionFacturable = 0;

        // Buscar el ÚLTIMO mensaje FACTURABLE (conversacion_facturable = 1)
        const ultimoMensajeFacturable = await this.mensajeRepo.findOne({
            where: {
                leadUuid: leadUuid,
                codigoEmpresa,
                conversacionFacturable: 1
            },
            order: { fechaCreacion: 'DESC' }
        });

        if (!ultimoMensajeFacturable) {
            // Primera conversación facturable
            conversacionFacturable = 1;
            this.logger.log(`[Stats] FACTURABLE: Primera conversación para lead ${leadUuid}`);
        } else {
            const ahora = new Date();
            const fechaUltimoFacturable = new Date(ultimoMensajeFacturable.fechaCreacion);
            const diffMs = ahora.getTime() - fechaUltimoFacturable.getTime();
            const diffHoras = diffMs / (1000 * 60 * 60);

            if (diffHoras > 24) {
                conversacionFacturable = 1;
                this.logger.log(`[Stats] FACTURABLE: Último mensaje facturable fue hace ${diffHoras.toFixed(2)}h (>24h) - lead ${leadUuid}`);
            } else {
                this.logger.log(`[Stats] NO facturable: Último mensaje facturable fue hace ${diffHoras.toFixed(2)}h (<24h) - lead ${leadUuid}`);
            }
        }

        for (let i = 0; i < mensajesSplit.length; i++) {
            const msgFragment = mensajesSplit[i];
            const isFacturable = (i === 0 && conversacionFacturable === 1) ? 1 : 0;

            if (isFacturable) {
                this.logger.log(`[Stats] Marcando mensaje actual como FACTURABLE (inicio de sesión).`);
            }

            // a. Guardar Respuesta Parcial en BD
            const mensajeBot = this.mensajeRepo.create({
                codigoEmpresa,
                leadUuid: leadUuid,
                idEmisorTipo: 2, // 2 = Bot
                contenido: msgFragment,
                numeroTelefono: from,
                fechaRecibido: null,
                fechaEnvio: new Date(),
                fechaCreacion: new Date(),
                estadoMensaje: 'enviado',
                leido: 0,
                conversacionFacturable: isFacturable
            });
            const mensajeBotGuardado = await this.mensajeRepo.save(mensajeBot);

            // Notificar respuesta del bot en tiempo real
            this.inboxGateway.notifyNewMessage(codigoEmpresa, leadUuid, {
                tipo: 'mensaje',
                id: mensajeBotGuardado.id,
                contenido: mensajeBotGuardado.contenido,
                fechaCreacion: mensajeBotGuardado.fechaCreacion,
                fechaEnvio: mensajeBotGuardado.fechaEnvio,
                idEmisorTipo: mensajeBotGuardado.idEmisorTipo,
                tipoEmisor: 'Bot',
                urlMultimedia: null,
                tipoMultimedia: null,
                estadoMensaje: mensajeBotGuardado.estadoMensaje,
                leido: mensajeBotGuardado.leido,
            });

            // b. Enviar Fragmento por WhatsApp
            const response: any = await this.wapiService.sendMessage(codigoEmpresa, from, msgFragment);

            // Actualizar estado en BD basado en respuesta WAPI
            let nuevoEstado = 'enviado';
            let wamid = null;
            let errorDetails = null;

            if (response && response.error) {
                nuevoEstado = 'fallido';
                errorDetails = response.details;
                this.logger.warn(`Error enviando fragmento IA: ${JSON.stringify(errorDetails)}`);
            } else {
                wamid = response?.messages?.[0]?.id || response?.id || null;
            }

            // Actualizar el mensaje guardado previously
            await this.mensajeRepo.update(
                { id: mensajeBotGuardado.id },
                {
                    wamidMsg: wamid ? String(wamid) : null,
                    estadoMensaje: nuevoEstado,
                    errorWapi: errorDetails
                }
            );
        }

        // Notificar actualización de conversaciones después de que el bot responde
        this.inboxGateway.notifyConversationsUpdate(codigoEmpresa);
    }

    private async handleStatusUpdate(status: any) {
        const wamid = status.id;
        const newState = status.status; // sent, delivered, read, failed

        let updateData: any = { estadoMensaje: newState };

        // Si el estado es 'failed', capturamos los errores
        if (newState === 'failed' && status.errors) {
            updateData.errorWapi = status.errors;
            this.logger.warn(`Mensaje fallido (Webhook): ${wamid} - ${JSON.stringify(status.errors)}`);
        }

        await this.mensajeRepo.update(
            { wamidMsg: wamid },
            updateData
        );

        this.logger.log(`Estado mensaje actualizado: ${wamid} -> ${newState}`);
    }
}
