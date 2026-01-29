import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_proyectos')
export class Proyecto {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'nombre' })
    nombre: string;

    @Column({ type: 'text', nullable: true })
    descripcion: string;

    @Column({ name: 'tipo_inmueble', nullable: true, default: 'Departamento' })
    tipoInmueble: string;

    @Column({ name: 'ubicacion', nullable: true })
    ubicacion: string;

    @Column({ name: 'precio_desde', type: 'decimal', precision: 12, scale: 2, nullable: true })
    precioDesde: number;

    @Column({ name: 'moneda', nullable: true, default: 'USD' })
    moneda: string;

    @Column({ name: 'estado', default: 'activo' })
    estado: string;

    @Column({ name: 'sperant_project_id', nullable: true })
    sperantProjectId: number;

    @Column({ type: 'json', name: 'json_data', nullable: true })
    jsonData: any;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
