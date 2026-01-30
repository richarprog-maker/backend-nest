import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('tbl_historial_plantillas')
export class HistorialPlantillas {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'lead_uid' })
    leadUid: number; // User asked for int lead_uid, presumably referencing id_lead from tbl_leads, but we have uuid in session. Will need to resolve this.

    @Column({ name: 'plantilla_id' })
    plantillaId: number;

    @Column({ name: 'tipo_mensaje' })
    tipoMensaje: string;

    // datetime(6) usually maps to Date in TypeORM with precision
    @Column({ name: 'fecha_envio', type: 'datetime', precision: 6 })
    fechaEnvio: Date;

    @Column()
    estado: string;

    @Column({ type: 'json', nullable: true })
    metadata: any;

    @CreateDateColumn({ name: 'created_at', precision: 6 })
    createdAt: Date;
}
