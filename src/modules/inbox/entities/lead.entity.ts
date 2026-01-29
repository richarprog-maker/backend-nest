import { Entity, Column, PrimaryGeneratedColumn, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Prospecto } from './prospecto.entity';

@Entity('tbl_leads')
export class Lead {
    @PrimaryGeneratedColumn({ name: 'id_lead' })
    id: number;

    @Column({ name: 'uuid', unique: true, generated: 'uuid' })
    uuid: string;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ nullable: true })
    nombre: string;

    @Column({ nullable: true })
    apellido: string;

    @Column({ name: 'telefono_principal' })
    telefono: string;

    @Column({ nullable: true })
    email: string;

    @Column({ nullable: true })
    dni: string;

    @Column({ nullable: true })
    pais: string;

    @Column({ nullable: true })
    ciudad: string;

    @Column({ nullable: true })
    direccion: string;

    @Column({ nullable: true, name: 'fecha_nacimiento' })
    fechaNacimiento: Date;

    @Column({ nullable: true })
    genero: string;

    @OneToMany(() => Prospecto, (prospecto) => prospecto.lead)
    prospectos: Prospecto[];

    @CreateDateColumn({ name: 'fecha_registro' })
    fechaRegistro: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    fechaActualizacion: Date;

    get nombreCompleto(): string {
        return `${this.nombre || ''} ${this.apellido || ''}`.trim();
    }
}
