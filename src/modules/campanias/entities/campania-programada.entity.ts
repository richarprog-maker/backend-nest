import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Campania } from './campania.entity';

export enum EstadoCampaniaProgramada {
    PENDIENTE = 'pendiente',
    PROCESANDO = 'procesando',
    COMPLETADO = 'completado',
    FALLIDO = 'fallido',
    CANCELADO = 'cancelado'
}

@Entity('tbl_campanias_programadas')
export class CampaniaProgramada {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Campania, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'campania_id' })
    campania: Campania;

    @Column({ name: 'campania_id' })
    campaniaId: number;

    @Column({ name: 'fecha_programada', type: 'datetime' })
    fechaProgramada: Date;

    @Column({
        type: 'enum',
        enum: EstadoCampaniaProgramada,
        default: EstadoCampaniaProgramada.PENDIENTE
    })
    estado: EstadoCampaniaProgramada;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'error_log', type: 'text', nullable: true })
    errorLog: string | null;

    @Column({ name: 'fecha_ejecucion', nullable: true })
    fechaEjecucion: Date | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
