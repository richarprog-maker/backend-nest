import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Req,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RecibirWebhookSperantDto } from './dto/recibir-webhook-sperant.dto';
import { WebhookSperantService } from './services/webhook-sperant.service';

@ApiTags('Webhook Sperant')
@Controller('webhook/sperant')
export class WebhookSperantController {
    constructor(private readonly webhookSperantService: WebhookSperantService) { }

    @Post(':codigoEmpresa')
    @HttpCode(HttpStatus.OK)
    @UsePipes(new ValidationPipe({
        whitelist: false,
        forbidNonWhitelisted: false,
        transform: true,
    }))
    @ApiOperation({ summary: 'Recibe leads enviados por webhook desde SPERANT' })
    async recibirWebhook(
        @Param('codigoEmpresa') codigoEmpresa: number,
        @Body() body: RecibirWebhookSperantDto,
        @Req() req: Request,
    ) {
        return this.webhookSperantService.registrarWebhook(
            codigoEmpresa,
            body,
            req.headers,
        );
    }
}
