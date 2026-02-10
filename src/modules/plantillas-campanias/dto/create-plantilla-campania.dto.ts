import { IsString, IsOptional, IsEnum, IsArray, IsInt } from 'class-validator';

export class CreatePlantillaCampaniaDto {
    @IsString()
    nombre: string;

    @IsString()
    contenido: string;

    @IsEnum(['imagen', 'video', 'audio', 'documento', 'ninguno'])
    @IsOptional()
    tipo_contenido_multimedia?: string;

    @IsString()
    @IsOptional()
    url_multimedia?: string;

    @IsArray()
    @IsOptional()
    parametros?: string[];

    @IsString()
    @IsOptional()
    idioma?: string;

    @IsString()
    @IsOptional()
    codigo_canal?: string;

    @IsInt()
    @IsOptional()
    codigo_empresa?: number;
}
