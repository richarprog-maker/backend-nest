import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Empresa } from './entities/empresa.entity';

@Injectable()
export class EmpresaService {
    private readonly logger = new Logger(EmpresaService.name);

    constructor(
        @InjectRepository(Empresa)
        private empresaRepo: Repository<Empresa>,
    ) { }

    async getConfiguracion(codigoEmpresa: number) {
        try {
            const empresa = await this.empresaRepo.findOne({
                where: { id: codigoEmpresa, estado: 1 }
            });

            if (!empresa) {
                return { Status: 'Error', message: 'Empresa no encontrada' };
            }

            return {
                Status: 'Success',
                data: {
                    id_empresa: empresa.id,
                    nombre_empresa: empresa.nombre,
                    razon_social: empresa.nombre, // Mapeo temporal
                    ruc: '', // No está en BD aún
                    direccion: empresa.direccion,
                    departamento: empresa.ciudad,
                    contacto: '', // No está en BD
                    telefono: empresa.telefono,
                    email: empresa.email,
                    pagina_web: empresa.webUrl,
                    historia_marca: empresa.descripcion,
                    personalidad_marca: empresa.slogan,
                    redes_sociales: empresa.redesSociales
                }
            };
        } catch (error) {
            this.logger.error(`Error obteniendo config empresa: ${error.message}`);
            return { Status: 'Error', message: 'Error interno' };
        }
    }
}
