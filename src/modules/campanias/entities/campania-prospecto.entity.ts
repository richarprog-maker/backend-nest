import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Campania } from './campania.entity';

@Entity('tbl_campania_prospectos')
export class CampaniaProspecto {
    @PrimaryGeneratedColumn({ name: 'id_detalle' })
    id: number;

    @Column({ name: 'id_campania' })
    idCampania: number;

    @Column({ name: 'lead_uuid' })
    leadUuid: string; // UUID del prospecto/cliente

    @Column({ name: 'estado_envio', default: 'pendiente' })
    estadoEnvio: string; // pendiente, enviado, entregado, leido, fallido

    @Column({ type: 'text', nullable: true })
    error_detalle: string;

    @CreateDateColumn({ name: 'fecha_envio' })
    fechaEnvio: Date;

    @ManyToOne(() => Campania, (campania) => campania.id)
    @JoinColumn({ name: 'id_campania' })
    campania: Campania;
}
