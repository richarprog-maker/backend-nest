import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_campanias')
export class Campania {
    @PrimaryGeneratedColumn({ name: 'id_campania' })
    id: number;

    @Column({ name: 'nombre_campania' })
    nombreCampania: string;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'fecha_programada', type: 'datetime', nullable: true })
    fechaProgramada: Date;

    @Column({ type: 'text', nullable: true })
    mensaje: string;

    @Column({ name: 'estado', default: 'borrador' }) // borrador, programada, enviando, completada
    estado: string;

    @Column({ name: 'cantidad_total', default: 0 })
    cantidadTotal: number;

    @Column({ name: 'cantidad_enviados', default: 0 })
    cantidadEnviados: number;

    @Column({ name: 'cantidad_fallidos', default: 0 })
    cantidadFallidos: number;

    @CreateDateColumn({ name: 'fecha_registro' })
    fechaRegistro: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    fechaActualizacion: Date;
}
