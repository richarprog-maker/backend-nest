import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PlantillaMensaje } from '../../plantillas/entities/plantilla.entity';

export enum EstadoCampania {
    BORRADOR = 'borrador',
    PROGRAMADO = 'programado',
    PROCESANDO = 'procesando',
    COMPLETADO = 'completado',
    CANCELADO = 'cancelado',
    PAUSADO = 'pausado',
    FALLIDO = 'fallido'
}

export enum TipoAudiencia {
    BASE_DATOS = 'base_datos',
    EXCEL = 'excel'
}

@Entity('tbl_campanias')
export class Campania {
    @PrimaryGeneratedColumn({ name: 'id_campania' })
    id: number;

    @Column({ name: 'nombre_campania' })
    nombre: string;

    @Column({ nullable: true })
    descripcion: string;

    @Column({ name: 'fecha_programada', type: 'datetime', nullable: true })
    fechaProgramada: Date;

    @Column({
        type: 'enum',
        enum: EstadoCampania,
        default: EstadoCampania.BORRADOR
    })
    estado: EstadoCampania;

    @Column({
        name: 'tipo_audiencia',
        type: 'varchar', // Cambiado a varchar para flexibilidad o enum si la BD lo soporta
        default: TipoAudiencia.BASE_DATOS
    })
    tipoAudiencia: TipoAudiencia;

    @Column({ name: 'filtros_audiencia', type: 'json', nullable: true })
    filtrosAudiencia: any;

    @Column({ name: 'archivo_audiencia_path', nullable: true })
    archivoAudienciaPath: string;

    @ManyToOne(() => PlantillaMensaje)
    @JoinColumn({ name: 'plantilla_id' })
    plantilla: PlantillaMensaje;

    @Column({ name: 'plantilla_id', nullable: true })
    plantillaId: number;

    @Column({ name: 'imagen_url', nullable: true })
    imagenUrl: string;

    @Column({ type: 'json', nullable: true })
    stats: any;

    @Column({ name: 'codigo_empresa', default: 1 })
    codigoEmpresa: number;

    @Column({ name: 'usuario_id', nullable: true })
    usuarioId: number;

    @CreateDateColumn({ name: 'fecha_registro' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    updatedAt: Date;
}
