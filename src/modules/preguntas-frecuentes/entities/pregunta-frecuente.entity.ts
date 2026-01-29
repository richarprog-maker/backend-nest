import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_preguntas_frecuentes')
export class PreguntaFrecuente {
    @PrimaryGeneratedColumn({ name: 'id_pregunta' })
    id: number;

    @Column({ name: 'uuid' })
    uuid: string;

    @Column({ name: 'id_proyecto' })
    idProyecto: number;

    @Column({ name: 'tipo' }) // 'Pregunta Frecuente' u 'Objeción Frecuente'
    tipo: string;

    @Column({ name: 'pregunta', type: 'text' })
    pregunta: string;

    @Column({ name: 'respuesta', type: 'text', nullable: true })
    respuesta: string;

    @Column({ name: 'tema', nullable: true }) // Added tema column support in entity though not in create table sql, user code implies it
    tema: string;

    @Column({ name: 'orden', default: 0 })
    orden: number;

    @CreateDateColumn({ name: 'fecha_registro' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    updatedAt: Date;
}
