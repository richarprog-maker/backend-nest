import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('tbl_sesion_conversacion')
@Index(['leadUuid', 'codigoEmpresa'], { unique: true })
@Index(['fechaHoraUltimoMsj'])
export class SesionConversacion {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'lead_uuid', type: 'varchar', length: 36 })
    leadUuid: string;

    @Column({ name: 'codigo_empresa', type: 'int' })
    codigoEmpresa: number;

    @Column({ name: 'id_msj_inicio', type: 'int', nullable: true })
    idMsjInicio: number;

    @Column({ name: 'fecha_hora_ultimo_msj', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    fechaHoraUltimoMsj: Date;

    @Column({ name: 'proximo_mensaje_minutos', type: 'int', default: 60 })
    proximoMensajeMinutos: number;

    @Column({ type: 'json', nullable: true })
    metadatos: any;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
