import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
    @ApiProperty({ example: 'admin', description: 'Código de vendedor o usuario' })
    @IsString()
    @IsNotEmpty()
    username: string;

    @ApiProperty({ example: '123456', description: 'Contraseña' })
    @IsString()
    @IsNotEmpty()
    password: string;
}
