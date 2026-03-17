import { Transform, Type } from 'class-transformer';
import {
    IsIn,
    IsNumber,
    IsNumberString,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';

function transformarNumeroOpcional({ value }: { value: unknown }) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    if (typeof value === 'number') {
        return value;
    }

    const numero = Number(value);
    return Number.isNaN(numero) ? value : numero;
}

function transformarTextoFlexible({ value }: { value: unknown }) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    return String(value);
}

export class ProyectoInteraccionSperantDto {
    @IsOptional()
    @Transform(transformarNumeroOpcional)
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
    @Transform(transformarNumeroOpcional)
    @IsNumber()
    seller_id?: number;
}

export class ClienteSperantDto {
    @Transform(transformarNumeroOpcional)
    @IsNumber()
    id: number;

    @IsOptional()
    @Transform(transformarTextoFlexible)
    @IsString()
    created_at?: string;

    @IsOptional()
    @IsString()
    fname?: string;

    @IsOptional()
    @IsString()
    lname?: string;

    @IsOptional()
    @Transform(transformarTextoFlexible)
    @IsString()
    person_type_id?: string;

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
    @Transform(transformarTextoFlexible)
    @IsString()
    last_interaction_at?: string;

    @IsOptional()
    @IsString()
    observation?: string;

    @IsOptional()
    @Transform(transformarNumeroOpcional)
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

    @IsOptional()
    @Transform(transformarNumeroOpcional)
    @IsNumber()
    seller_id?: number;
}

export class RecibirWebhookSperantDto {
    @IsIn(['client_created', 'client_digital'])
    event_name: 'client_created' | 'client_digital';

    @ValidateNested()
    @Type(() => ClienteSperantDto)
    client: ClienteSperantDto;

    @IsOptional()
    @Transform(transformarNumeroOpcional)
    @IsNumber()
    current_user_id?: number;

    @IsOptional()
    @Transform(transformarNumeroOpcional)
    @IsNumber()
    seller_id?: number;

    @IsOptional()
    @IsString()
    token?: string;

    @IsOptional()
    @IsObject()
    extra?: Record<string, any>;
}
