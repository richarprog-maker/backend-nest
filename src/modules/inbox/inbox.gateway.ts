import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { InboxService } from './inbox.service';

@WebSocketGateway({
    cors: {
        origin: [process.env.FRONTEND_URL],
        credentials: true,
    },
})
export class InboxGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(InboxGateway.name);
    private userSockets = new Map<string, string>(); // userId -> socketId

    constructor(
        @Inject(forwardRef(() => InboxService))
        private inboxService: InboxService,
    ) { }

    handleConnection(client: Socket) {
        this.logger.log(`[🥂] Cliente conectado: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`[X] Cliente desconectado: ${client.id}`);
        // Remover del mapa
        for (const [userId, socketId] of this.userSockets.entries()) {
            if (socketId === client.id) {
                this.userSockets.delete(userId);
                break;
            }
        }
    }

    @SubscribeMessage('join')
    handleJoin(
        @MessageBody() data: { userId: string; empresaId: number },
        @ConnectedSocket() client: Socket,
    ) {
        this.userSockets.set(data.userId.toString(), client.id);
        client.join(`empresa_${data.empresaId}`);
        this.logger.log(`👤 Usuario ${data.userId} unido a empresa ${data.empresaId}`);
        return { success: true, message: 'Conectado exitosamente' };
    }

    @SubscribeMessage('joinConversation')
    async handleJoinConversation(
        @MessageBody() data: { leadUuid: string; empresaId: number },
        @ConnectedSocket() client: Socket,
    ) {
        client.join(`conversation_${data.leadUuid}`);
        this.logger.log(`Cliente ${client.id} unido a conversación ${data.leadUuid}`);

        // Marcar mensajes como leídos automáticamente
        if (data.empresaId && data.leadUuid) {
            await this.inboxService.marcarComoLeido(data.leadUuid, data.empresaId);
        }
    }

    @SubscribeMessage('leaveConversation')
    handleLeaveConversation(
        @MessageBody() data: { leadUuid: string },
        @ConnectedSocket() client: Socket,
    ) {
        client.leave(`conversation_${data.leadUuid}`);
        this.logger.log(`Cliente ${client.id} salió de conversación ${data.leadUuid}`);
    }

    // Emitir nuevo mensaje a todos los usuarios de la empresa
    notifyNewMessage(empresaId: number, leadUuid: string, mensaje: any) {
        this.server.to(`empresa_${empresaId}`).emit('newMessage', {
            leadUuid,
            mensaje,
        });
        this.logger.log(`Nuevo mensaje notificado - Empresa: ${empresaId}, Lead: ${leadUuid}`);
    }

    // Emitir mensaje solo a la conversación específica
    notifyMessageToConversation(leadUuid: string, mensaje: any) {
        this.server.to(`conversation_${leadUuid}`).emit('messageReceived', mensaje);
        this.logger.log(`Mensaje enviado a conversación ${leadUuid}`);
    }

    // Notificar actualización de conversaciones
    notifyConversationsUpdate(empresaId: number) {
        this.server.to(`empresa_${empresaId}`).emit('conversationsUpdate');
        this.logger.log(`Actualización de conversaciones notificada - Empresa: ${empresaId}`);
    }
}
