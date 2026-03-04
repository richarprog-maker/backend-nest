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

    @Column({ name: 'numero_telefono', type: 'varchar', length: 20, nullable: true })
    numeroTelefono: string;

    @Column({ name: 'proyecto_id', type: 'int', nullable: true })
    proyectoId: number;

    @Column({ name: 'id_msj_inicio', type: 'int', nullable: true })
    idMsjInicio: number;

    @Column({ name: 'fecha_hora_ultimo_msj', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    fechaHoraUltimoMsj: Date;

    @Column({ name: 'proximo_mensaje_minutos', type: 'int', default: 60 })
    proximoMensajeMinutos: number;

    @Column({ name: 'id_estado', type: 'int', default: 1 })
    idEstado: number;

    @Column({ name: 'resumen_conversacion', type: 'text', nullable: true })
    resumenConversacion: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
