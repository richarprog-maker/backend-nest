import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vendedor } from './entities/vendedor.entity';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(Vendedor)
        private vendedoresRepository: Repository<Vendedor>,
        private jwtService: JwtService,
    ) { }

    async validateUser(email: string, pass: string): Promise<any> {
        const user = await this.vendedoresRepository.findOne({
            where: { email: email, estado: 'activo' }
        });

        if (user && await bcrypt.compare(pass, user.password || '')) {
            const { password, ...result } = user;
            return result;
        }
        return null;
    }

    async login(loginDto: LoginDto) {
        const user = await this.vendedoresRepository.findOne({
            where: {
                email: loginDto.username,
                estado: 'activo'
            }
        });

        if (!user) {
            throw new UnauthorizedException('Credenciales inválidas');
        }

        const isMatch = await bcrypt.compare(loginDto.password, user.password);
        if (!isMatch) {
            throw new UnauthorizedException('Credenciales inválidas');
        }

        const payload = {
            sub: user.id,
            username: user.email,
            empresaId: user.codigoEmpresa,
            rol: user.rol
        };

        const token = this.jwtService.sign(payload);

        return {
            Status: 'Success',
            token: token,
            user: {
                id: user.id,
                nombre: user.nombre,
                apellido: user.apellido,
                email: user.email,
                rol: user.rol,
                codigoEmpresa: user.codigoEmpresa
            },
            requiresPasswordChange: false
        };
    }
}
