import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, JoinColumn, ManyToOne } from 'typeorm';
import { SesionConversacion } from '../../ia/entities/sesion-conversacion.entity';

@Entity('tbl_historial_clasificacion_lead')
export class HistorialClasificacionLead {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'id_sesion', type: 'int' })
    idSesion: number;

    @ManyToOne(() => SesionConversacion)
    @JoinColumn({ name: 'id_sesion' })
    sesion: SesionConversacion;

    @Column({ type: 'varchar', length: 50 })
    clasificacion: string; // 'alto', 'bajo', 'medio', 'descartado'

    @Column({ type: 'text', nullable: true })
    razon: string;

    @CreateDateColumn({ name: 'fecha_creacion' })
    fechaCreacion: Date;
}
