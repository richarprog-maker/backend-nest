import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_citas')
export class Cita {
    @PrimaryGeneratedColumn({ name: 'id_cita' })
    id: number;

    @Column({ name: 'lead_uuid', nullable: true })
    leadUuid: string;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'id_vendedor', nullable: true })
    idVendedor: number;

    @Column({ name: 'fecha_cita', type: 'date' })
    fechaCita: string;

    @Column({ name: 'hora_cita', type: 'time' })
    horaCita: string;

    @Column({ name: 'tipo_cita', nullable: true })
    tipoCita: string; // 'presencial' | 'virtual'

    @Column({ name: 'estado_cita', default: 'pendiente' })
    estadoCita: string; // pendiente, confirmada, cancelada, realizada

    @Column({ type: 'text', nullable: true })
    observacion: string;

    @CreateDateColumn({ name: 'fecha_creacion' })
    fechaRegistro: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    fechaActualizacion: Date;
}
