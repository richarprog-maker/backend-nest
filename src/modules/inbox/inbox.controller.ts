import { Controller, Get, Post, Body, Query, Param, UseGuards, Req, Logger, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InboxService } from './inbox.service';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { RedisService } from '../common/redis/redis.service';

@ApiTags('Inbox')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('inbox')
export class InboxController {
    private readonly logger = new Logger(InboxController.name);

    constructor(
        private inboxService: InboxService,
        private redisService: RedisService
    ) { }

    @Get('conversations')
    @ApiOperation({ summary: 'Obtener lista de conversaciones con últimos mensajes y archivos' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'filter', required: false, enum: ['all', 'unread'] })
    @ApiQuery({ name: 'search', required: false, type: String })
    async getConversations(
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 50,
        @Query('filter') filter: string = 'all',
        @Query('search') search: string = '',
        @Req() req
    ) {
        const user = req.user;
        const empresaId = user?.empresaId || 91;

        this.logger.log(`GET conversations - User: ${user?.username}, EmpresaId: ${empresaId}, Filter: ${filter}, Search: ${search}`);

        return this.inboxService.getConversaciones(empresaId, page, limit, filter, search);
    }

    @Get('messages/:leadUuid')
    @ApiOperation({ summary: 'Obtener historial completo de mensajes (texto + archivos) con un prospecto' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    async getMessages(
        @Param('leadUuid') leadUuid: string,
        @Query('limit') limit: number = 200,
        @Req() req
    ) {
        const user = req.user;
        const empresaId = user?.empresaId || 91;

        this.logger.log(`GET messages - Lead: ${leadUuid}, EmpresaId: ${empresaId}`);

        return this.inboxService.getHistorialChat(leadUuid, empresaId, limit);
    }

    @Post('send')
    @ApiOperation({ summary: 'Enviar mensaje a un prospecto (texto o archivo)' })
    async sendMessage(@Body() body: any, @Req() req) {
        const user = req.user;
        const empresaId = user?.empresaId || 91;

        this.logger.log(`POST send - Lead: ${body.leadUuid}, EmpresaId: ${empresaId}`);

        return this.inboxService.enviarMensaje({
            leadUuid: body.leadUuid,
            codigoEmpresa: empresaId,
            contenido: body.contenido || '',
            idUsuario: user?.userId,
            tipoMultimedia: body.tipoMultimedia,
            urlMultimedia: body.urlMultimedia
        });
    }

    @Post('upload')
    @ApiOperation({ summary: 'Subir archivo multimedia (imagen, documento, video, audio)' })
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: './storage/inbox',
                filename: (req, file, callback) => {
                    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                    const ext = extname(file.originalname);
                    callback(null, `inbox_${uniqueSuffix}${ext}`);
                },
            }),
            limits: {
                fileSize: 16 * 1024 * 1024, // 16MB
            },
        }),
    )
    async uploadFile(
        @UploadedFile() file: Express.Multer.File,
        @Body('leadUuid') leadUuid: string,
        @Body('contenido') contenido: string,
        @Req() req
    ) {
        const user = req.user;
        const empresaId = user?.empresaId || 91;

        if (!file) {
            return { success: false, message: 'No se recibió ningún archivo' };
        }

        this.logger.log(`Upload file - Lead: ${leadUuid}, File: ${file.filename}, Size: ${file.size}`);

        const tipoMultimedia = file.mimetype.split('/')[0]; // image, video, audio, application
        const urlMultimedia = `/storage/inbox/${file.filename}`;

        return this.inboxService.enviarMensaje({
            leadUuid,
            codigoEmpresa: empresaId,
            contenido: contenido || '',
            idUsuario: user?.userId,
            tipoMultimedia,
            urlMultimedia
        });
    }

    @Post('bot/pause/:leadUuid')
    @ApiOperation({ summary: 'Pausar el bot para una conversación específica' })
    async pauseBot(@Param('leadUuid') leadUuid: string) {
        await this.redisService.pauseChat(leadUuid);
        return { success: true, message: 'Bot pausado' };
    }

    @Post('bot/unpause/:leadUuid')
    @ApiOperation({ summary: 'Reactivar el bot para una conversación específica' })
    async unpauseBot(@Param('leadUuid') leadUuid: string) {
        await this.redisService.unpauseChat(leadUuid);
        return { success: true, message: 'Bot reactivado' };
    }

    @Get('bot/status/:leadUuid')
    @ApiOperation({ summary: 'Verificar si el bot está pausado para una conversación' })
    async getBotStatus(@Param('leadUuid') leadUuid: string) {
        const isPaused = await this.redisService.isPaused(leadUuid);
        return { paused: isPaused };
    }

    @Post('mark-as-read/:leadUuid')
    @ApiOperation({ summary: 'Marcar mensajes de una conversación como leídos' })
    async markAsRead(
        @Param('leadUuid') leadUuid: string,
        @Req() req
    ) {
        const user = req.user;
        const empresaId = user?.empresaId || 91;

        this.logger.log(`POST mark-as-read - Lead: ${leadUuid}, EmpresaId: ${empresaId}`);

        return this.inboxService.marcarComoLeido(leadUuid, empresaId);
    }
}
