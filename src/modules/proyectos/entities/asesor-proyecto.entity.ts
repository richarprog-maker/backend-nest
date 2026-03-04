import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Vendedor } from '../../auth/entities/vendedor.entity';
import { Proyecto } from './proyecto.entity';

@Entity('tbl_vendedores_proyectos')
export class VendedorProyecto {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'id_vendedor' })
    idVendedor: number;

    @Column({ name: 'proyecto_id' })
    proyectoId: number;

    @ManyToOne(() => Vendedor)
    @JoinColumn({ name: 'id_vendedor' })
    vendedor: Vendedor;

    @ManyToOne(() => Proyecto)
    @JoinColumn({ name: 'proyecto_id' })
    proyecto: Proyecto;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
