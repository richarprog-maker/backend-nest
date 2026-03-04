import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Proyecto } from './proyecto.entity';

@Entity('tbl_colecciones_qdrant')
export class ColeccionQdrant {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'id_proyecto' })
    idProyecto: number;

    @Column({ name: 'tipo_coleccion' })
    tipoColeccion: string;

    @Column({ name: 'nombre_coleccion' })
    nombreColeccion: string;

    @Column({ name: 'estado', default: 'activo' })
    estado: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @ManyToOne(() => Proyecto)
    @JoinColumn({ name: 'id_proyecto' })
    proyecto: Proyecto;
}
