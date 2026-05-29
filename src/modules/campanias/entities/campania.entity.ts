import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PlantillaCampania } from '../../plantillas-campanias/entities/plantilla-campania.entity';
import { Proyecto } from '../../proyectos/entities/proyecto.entity';

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
        type: 'varchar',
        default: TipoAudiencia.BASE_DATOS
    })
    tipoAudiencia: TipoAudiencia;

    @Column({ name: 'filtros_audiencia', type: 'json', nullable: true })
    filtrosAudiencia: any;

    @Column({ name: 'archivo_audiencia_path', nullable: true })
    archivoAudienciaPath: string;

    @ManyToOne(() => PlantillaCampania)
    @JoinColumn({ name: 'plantilla_id' })
    plantilla: PlantillaCampania;

    @Column({ name: 'plantilla_id', nullable: true })
    plantillaId: number;

    @Column({ name: 'imagen_url', nullable: true })
    imagenUrl: string;

    @Column({ type: 'json', nullable: true })
    stats: any;

    @Column({ name: 'codigo_empresa', default: 1 })
    codigoEmpresa: number;

    @ManyToOne(() => Proyecto)
    @JoinColumn({ name: 'proyecto_id' })
    proyecto: Proyecto;

    @Column({ name: 'proyecto_id', nullable: true })
    proyectoId: number;

    @Column({ name: 'usuario_id', nullable: true })
    usuarioId: number;

    @Column({ name: 'asesor_id', nullable: true })
    asesorId: number; // Asesor responsable: su id_vendedor se propaga a sesion_conversacion al procesar

    @CreateDateColumn({ name: 'fecha_registro' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    updatedAt: Date;
}
