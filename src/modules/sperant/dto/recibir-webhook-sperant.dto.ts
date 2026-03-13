import { Type } from 'class-transformer';
import {
    IsIn,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';

export class ProyectoInteraccionSperantDto {
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    project_id?: number;

    @IsOptional()
    @IsString()
    interest_type_name?: string;

    @IsOptional()
    @IsString()
    captation_way?: string;

    @IsOptional()
    @IsString()
    input_channel_name?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    seller_id?: number;
}

export class ClienteSperantDto {
    @Type(() => Number)
    @IsNumber()
    id: number;

    @IsOptional()
    @IsString()
    created_at?: string;

    @IsOptional()
    @IsString()
    fname?: string;

    @IsOptional()
    @IsString()
    lname?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    person_type_id?: number;

    @IsOptional()
    @IsString()
    gender?: string;

    @IsOptional()
    @IsString()
    document_type_name?: string;

    @IsOptional()
    @IsString()
    document?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsString()
    email?: string;

    @IsOptional()
    @IsString()
    last_interaction_at?: string;

    @IsOptional()
    @IsString()
    observation?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    project_id?: number;

    @IsOptional()
    @IsString()
    interest_type_name?: string;

    @IsOptional()
    @IsString()
    captation_way?: string;

    @IsOptional()
    @IsString()
    input_channel_name?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => ProyectoInteraccionSperantDto)
    last_interaction_project?: ProyectoInteraccionSperantDto;
}

export class RecibirWebhookSperantDto {
    @IsIn(['client_created', 'client_digital'])
    event_name: 'client_created' | 'client_digital';

    @ValidateNested()
    @Type(() => ClienteSperantDto)
    client: ClienteSperantDto;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    current_user_id?: number;

    @IsOptional()
    @IsString()
    token?: string;

    @IsOptional()
    @IsObject()
    extra?: Record<string, any>;
}
