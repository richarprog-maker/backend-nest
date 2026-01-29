import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Between } from 'typeorm';
import { Prospecto } from '../../inbox/entities/prospecto.entity';
import { Lead } from '../../inbox/entities/lead.entity';

@Injectable()
export class ProspectosService {
    constructor(
        @InjectRepository(Prospecto) private prospectoRepo: Repository<Prospecto>,
        @InjectRepository(Lead) private leadRepo: Repository<Lead>,
    ) { }

    async findAll(query: any) {
        const page = query.page || 1;
        const limit = query.limit || 50;
        const skip = (page - 1) * limit;

        const qb = this.prospectoRepo.createQueryBuilder('p')
            .leftJoinAndSelect('p.lead', 'l')
            .skip(skip)
            .take(limit)
            .orderBy('p.fechaRegistro', 'DESC');

        if (query.search) {
            qb.andWhere('(l.nombre LIKE :s OR l.apellido LIKE :s OR l.telefono LIKE :s OR l.email LIKE :s)', { s: `%${query.search}%` });
        }

        // TODO: Filtros de fecha y temperatura

        const [data, total] = await qb.getManyAndCount();

        // Mapeo para el frontend
        const items = data.map(p => {
            const json = p.json_data || {};
            return {
                id_prospecto: p.id,
                idLead: p.idLead,
                nombre: p.interesNombre || (p.origenDato === 'Excel' ? 'Importado' : 'Prospecto'),
                tipoRegistro: p.origenDato === 'Excel' ? 'Manual' : 'Automático',
                etiqueta: 'Prospecto',
                fecha_creacion: p.fechaRegistro,
                origen: p.origenDato,
                contactado: p.estadoGestion,

                // Datos Persona
                nombrePersona: p.lead?.nombre,
                apellido: p.lead?.apellido,
                dni: p.lead?.dni,
                celular: p.lead?.telefono,
                correo: p.lead?.email,

                // Datos dinámicos del JSON
                temperatura: json.temperatura || 'Frio',
                marca: json.marca || json.brand,
                tienda: json.tienda || json.store,
                departamento: json.departamento || json.department || p.lead?.ciudad,
                distrito: json.distrito || json.district,
                productos: json.producto || json.product,

                // Extras
                fechaCita: json.fecha_cita,
                fechaDerivacion: json.fecha_derivacion,
                tiempoDerivacion: json.tiempo_derivacion
            };
        });

        return {
            data: items,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }
}
