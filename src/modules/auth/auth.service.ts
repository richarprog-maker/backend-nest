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

    // --- MÉTODOS ADMINISTRADORES PARA GESTIÓN DE VENDEDORES ---

    async getVendedores(userPayload: any) {
        if (userPayload.rol !== 'admin' && userPayload.rol !== 'super_admin') {
            throw new UnauthorizedException('No tienes permiso para ver esta sección');
        }

        const vendedores = await this.vendedoresRepository.find({
            where: { codigoEmpresa: userPayload.empresaId },
            select: ['id', 'nombre', 'apellido', 'email', 'rol', 'telefono', 'estado', 'fechaCreacion'],
            order: { nombre: 'ASC' }
        });

        return { success: true, data: vendedores };
    }

    async createVendedor(userPayload: any, body: any) {
        if (userPayload.rol !== 'admin' && userPayload.rol !== 'super_admin') {
            throw new UnauthorizedException('No tienes permiso para realizar esta acción');
        }

        // Verificar si existe el correo
        const existe = await this.vendedoresRepository.findOne({
            where: { email: body.email, codigoEmpresa: userPayload.empresaId }
        });

        if (existe) {
            throw new UnauthorizedException('El correo ya está registrado en esta empresa');
        }

        const hashedPassword = await bcrypt.hash(body.password, 10);

        const nuevo = this.vendedoresRepository.create({
            codigoEmpresa: userPayload.empresaId,
            nombre: body.nombre,
            apellido: body.apellido,
            email: body.email,
            password: hashedPassword,
            rol: body.rol || 'vendedor',
            telefono: body.telefono,
            estado: body.estado || 'activo'
        });

        const guardado = await this.vendedoresRepository.save(nuevo);
        const { password, ...result } = guardado;
        return { success: true, data: result };
    }

    async updateVendedor(userPayload: any, id: number, body: any) {
        if (userPayload.rol !== 'admin' && userPayload.rol !== 'super_admin') {
            throw new UnauthorizedException('No tienes permiso para realizar esta acción');
        }

        const vendedor = await this.vendedoresRepository.findOne({
            where: { id, codigoEmpresa: userPayload.empresaId }
        });

        if (!vendedor) {
            throw new UnauthorizedException('Vendedor no encontrado');
        }

        if (body.nombre) vendedor.nombre = body.nombre;
        if (body.apellido) vendedor.apellido = body.apellido;

        // Si cambia el correo, validar
        if (body.email && body.email !== vendedor.email) {
            const existe = await this.vendedoresRepository.findOne({
                where: { email: body.email, codigoEmpresa: userPayload.empresaId }
            });
            if (existe) throw new UnauthorizedException('El correo ya está registrado por otro vendedor');
            vendedor.email = body.email;
        }

        if (body.rol) vendedor.rol = body.rol;
        if (body.telefono !== undefined) vendedor.telefono = body.telefono;
        if (body.estado) vendedor.estado = body.estado;

        if (body.password) {
            vendedor.password = await bcrypt.hash(body.password, 10);
        }

        const actualizado = await this.vendedoresRepository.save(vendedor);
        const { password, ...result } = actualizado;

        return { success: true, data: result };
    }
}
