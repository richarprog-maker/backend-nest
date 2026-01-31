import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Campania } from './campania.entity';

export enum EstadoCampaniaDetalle {
    PENDIENTE = 'pendiente',
    ENVIADO = 'enviado',
    ENTREGADO = 'entregado',
    LEIDO = 'leido',
    FALLIDO = 'fallido'
}

@Entity('tbl_campania_detalles')
@Index(['campaniaId', 'telefono']) // Índice para búsquedas rápidas
@Index(['campaniaId', 'estado'])   // Índice para estadísticas
export class CampaniaDetalle {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Campania, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'campania_id' })
    campania: Campania;

    @Column({ name: 'campania_id' })
    campaniaId: number;

    @Column()
    telefono: string;

    @Column({ nullable: true })
    nombre: string;

    @Column({ type: 'json', nullable: true })
    variables: any;

    @Column({
        type: 'enum',
        enum: EstadoCampaniaDetalle,
        default: EstadoCampaniaDetalle.PENDIENTE
    })
    estado: EstadoCampaniaDetalle;

    @Column({ nullable: true, comment: 'WhatsApp Message ID' })
    wamid: string;

    @Column({ name: 'tipo_multimedia', default: 'none' })
    tipoMultimedia: string;

    @Column({ name: 'url_multimedia', nullable: true })
    urlMultimedia: string;

    @Column({ name: 'error_log', type: 'text', nullable: true })
    errorLog: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
