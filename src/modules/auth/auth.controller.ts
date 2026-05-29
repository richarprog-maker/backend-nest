import { Controller, Post, Get, Put, Body, Param, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('login')
    @ApiOperation({ summary: 'Iniciar sesión' })
    @HttpCode(HttpStatus.OK)
    async login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    @Post('/sign-in')
    @ApiOperation({ summary: 'Iniciar sesión (alias)' })
    @HttpCode(HttpStatus.OK)
    async signIn(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    // --- ENDPOINTS ADMINISTRADORES PARA GESTIÓN DE VENDEDORES ---

    @Get('vendedores')
    @ApiBearerAuth()
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ summary: 'Listar todos los vendedores (solo admin/super_admin)' })
    async getVendedores(@Req() req: any) {
        return this.authService.getVendedores(req.user);
    }

    @Post('vendedores')
    @ApiBearerAuth()
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ summary: 'Crear nuevo vendedor' })
    async createVendedor(@Req() req: any, @Body() body: any) {
        return this.authService.createVendedor(req.user, body);
    }

    @Put('vendedores/:id')
    @ApiBearerAuth()
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ summary: 'Actualizar vendedor' })
    async updateVendedor(@Req() req: any, @Param('id') id: number, @Body() body: any) {
        return this.authService.updateVendedor(req.user, id, body);
    }

    @Put('vendedores/:id/estado')
    @ApiBearerAuth()
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ summary: 'Activar o desactivar vendedor (gestión de vacaciones/disponibilidad)' })
    async toggleEstadoVendedor(
        @Req() req: any,
        @Param('id') id: number,
        @Body('estado') estado: 'activo' | 'inactivo',
    ) {
        return this.authService.toggleEstadoVendedor(req.user, id, estado);
    }
}
