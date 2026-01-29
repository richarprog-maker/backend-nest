import { Controller, Get, Post, Query, Body, Param, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { WebhookService } from './webhook.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
    constructor(private readonly webhookService: WebhookService) { }

    @Get('messages/:codigoEmpresa') // Compatibilidad con legacy path
    @ApiOperation({ summary: 'Verificación de Webhook Meta' })
    verifyWebhook(
        @Query('hub.mode') mode: string,
        @Query('hub.verify_token') token: string,
        @Query('hub.challenge') challenge: string,
        @Res() res: Response // Necesario para evitar formato JSON NestJS por defecto
    ) {
        const response = this.webhookService.verifyWebhook(mode, token, challenge);

        if (response) {
            return res.status(HttpStatus.OK).send(response);
        }

        return res.sendStatus(HttpStatus.UNAUTHORIZED);
    }

    @Post('messages/:codigoEmpresa')
    @ApiOperation({ summary: 'Recepción de mensajes Meta' })
    async receiveMessage(
        @Param('codigoEmpresa') codigoEmpresa: number,
        @Body() body: any
    ) {
        await this.webhookService.processIncomingMessage(codigoEmpresa, body);
        return { status: 'success' };
    }
}
