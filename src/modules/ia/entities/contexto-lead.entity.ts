import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_contexto_lead')
export class ContextoLead {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'lead_uuid' }) // Se relaciona por UUID según schema
    leadUuid: string;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'nombre_completo', nullable: true })
    nombreCompleto: string;

    @Column({ name: 'proyectos_interes', type: 'json', nullable: true })
    proyectosInteres: any;

    @CreateDateColumn({ name: 'fecha_creacion' })
    fechaCreacion: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    fechaActualizacion: Date;
}
