import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Lead } from '../../inbox/entities/lead.entity';
import { PlantillaMensaje } from '../../plantillas/entities/plantilla.entity';

@Entity('tbl_historial_plantillas')
export class HistorialEnvio {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'lead_id' })
    leadId: number;

    @ManyToOne(() => Lead)
    @JoinColumn({ name: 'lead_id' })
    lead: Lead;

    @Column({ name: 'plantilla_id', nullable: true })
    plantillaId: number;

    @ManyToOne(() => PlantillaMensaje)
    @JoinColumn({ name: 'plantilla_id' })
    plantilla: PlantillaMensaje;

    @Column({ name: 'tipo_mensaje' })
    tipoMensaje: string; // PRIMER_CONTACTO, RECUPERACION_1H, etc.

    @Column({ name: 'fecha_envio' })
    fechaEnvio: Date;

    @Column({ default: 'ENVIADO' })
    estado: string; // ENVIADO, FALLIDO, PENDIENTE

    @Column({ type: 'json', nullable: true })
    metadata: any;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
