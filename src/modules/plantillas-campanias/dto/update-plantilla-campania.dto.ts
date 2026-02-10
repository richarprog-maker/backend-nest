import { PartialType } from '@nestjs/mapped-types';
import { CreatePlantillaCampaniaDto } from './create-plantilla-campania.dto';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdatePlantillaCampaniaDto extends PartialType(
    CreatePlantillaCampaniaDto,
) {
    @IsEnum(['LOCAL', 'PENDING', 'APPROVED', 'REJECTED'])
    @IsOptional()
    metaStatus?: string;

    @IsString()
    @IsOptional()
    metaTemplateId?: string;

    @IsString()
    @IsOptional()
    metaError?: string;
}
