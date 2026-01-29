import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_bots')
export class Bot {
    @PrimaryGeneratedColumn({ name: 'id_bot' })
    id: number;

    @Column({ name: 'codigo_bot', unique: true })
    codigoBot: string;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column()
    nombre: string;

    @Column({ default: 'neutro' })
    genero: string;

    @Column({ name: 'tipo_atencion', default: 'inbound/outbound' })
    tipoAtencion: string;

    @Column({ name: 'codigo_canal', default: 'whatsapp' })
    codigoCanal: string;

    @Column({ name: 'habilitado', default: 1 })
    habilitado: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
