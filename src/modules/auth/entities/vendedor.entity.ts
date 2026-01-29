import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_vendedores')
export class Vendedor {
    @PrimaryGeneratedColumn({ name: 'id_vendedor' })
    id: number;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'nombre' })
    nombre: string;

    @Column({ name: 'apellido', nullable: true })
    apellido: string;

    @Column({ name: 'email', unique: true })
    email: string;

    @Column({ name: 'password' })
    password: string;

    @Column({ name: 'rol', default: 'vendedor' })
    rol: string; // admin, vendedor

    @Column({ name: 'telefono', nullable: true })
    telefono: string;

    @Column({ name: 'estado_vendedor', default: 'activo' })
    estado: string; // activo, inactivo

    @CreateDateColumn({ name: 'fecha_creacion' })
    fechaCreacion: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    fechaActualizacion: Date;
}
