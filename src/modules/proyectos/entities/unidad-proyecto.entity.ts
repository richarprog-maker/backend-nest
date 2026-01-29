
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Proyecto } from './proyecto.entity';

@Entity('tbl_unidades_proyectos')
export class UnidadProyecto {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'id_proyecto' })
    idProyecto: number;

    @Column({ name: 'unidad' })
    unidad: string;

    @Column({ name: 'tipo_unidad', nullable: true })
    tipoUnidad: string;

    @Column({ name: 'tipologia', nullable: true })
    tipologia: string;

    @Column({ name: 'nro_piso', nullable: true })
    nroPiso: number;

    @Column({ name: 'nro_dormitorios', nullable: true })
    nroDormitorios: number;

    @Column({ name: 'vista', nullable: true })
    vista: string;

    @Column({ name: 'area_total', type: 'decimal', precision: 10, scale: 2, nullable: true })
    areaTotal: number;

    @Column({ name: 'area_techada', type: 'decimal', precision: 10, scale: 2, nullable: true })
    areaTechada: number;

    @Column({ name: 'area_libre', type: 'decimal', precision: 10, scale: 2, nullable: true })
    areaLibre: number;

    @Column({ name: 'precio_lista', type: 'decimal', precision: 12, scale: 2, nullable: true })
    precioLista: number;

    @Column({ name: 'moneda_lista', default: 'soles' })
    monedaLista: string;

    @Column({ name: 'precio_promocion', type: 'decimal', precision: 12, scale: 2, nullable: true })
    precioPromocion: number;

    @Column({ name: 'fecha_fin_promocion', nullable: true })
    fechaFinPromocion: string;

    @Column({ name: 'disponibilidad', default: 'Sí' })
    disponibilidad: string;

    @Column({ name: 'url_plano', type: 'text', nullable: true })
    urlPlano: string;

    @Column({ name: 'url_ubicacion', type: 'text', nullable: true })
    urlUbicacion: string;

    @Column({ name: 'url_plano_2', type: 'text', nullable: true })
    urlPlano2: string;

    @Column({ name: 'features_json', type: 'json', nullable: true })
    featuresJson: any;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @ManyToOne(() => Proyecto)
    @JoinColumn({ name: 'id_proyecto' })
    proyecto: Proyecto;
}
