import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_bots')
export class Bot {
    @PrimaryGeneratedColumn({ name: 'id_bot' })
    id: number;

    @Column({ name: 'codigo_bot' })
    codigoBot: string;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'nombre' })
    nombre: string;

    @Column({ name: 'genero', default: 'neutro' })
    genero: string;

    @Column({ name: 'tipo_atencion', default: 'inbound/outbound' })
    tipoAtencion: string;

    @Column({ name: 'codigo_canal', default: 'whatsapp' })
    codigoCanal: string;

    @Column({ name: 'codigo_credencial', nullable: true })
    codigoCredencial: string;

    @Column({ name: 'habilitado', type: 'tinyint', default: 1 })
    habilitado: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
