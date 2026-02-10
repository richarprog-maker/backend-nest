import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('tbl_plantillas_campanias')
export class PlantillaCampania {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 255 })
    nombre: string;

    @Column({ type: 'text' })
    contenido: string;

    @Column({
        type: 'enum',
        enum: ['imagen', 'video', 'audio', 'documento', 'ninguno'],
        default: 'ninguno',
    })
    tipo_contenido_multimedia: string;

    @Column({ type: 'varchar', length: 500, nullable: true })
    url_multimedia: string;

    @Column({ type: 'json', nullable: true })
    parametros: string[];

    @Column({ type: 'varchar', length: 10, default: 'es_PE' })
    idioma: string;

    @Column({ type: 'varchar', length: 50, default: 'whatsapp' })
    codigo_canal: string;

    // Campos de integración Meta
    @Column({
        type: 'enum',
        enum: ['LOCAL', 'PENDING', 'APPROVED', 'REJECTED'],
        default: 'LOCAL',
    })
    metaStatus: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    metaTemplateId: string;

    @Column({ type: 'datetime', nullable: true })
    metaSyncedAt: Date;

    @Column({ type: 'text', nullable: true })
    metaError: string;

    // Auditoría
    @Column({ type: 'int', default: 1 })
    codigo_empresa: number;

    @CreateDateColumn({ type: 'datetime', precision: 6 })
    created_at: Date;

    @UpdateDateColumn({ type: 'datetime', precision: 6 })
    updated_at: Date;
}
