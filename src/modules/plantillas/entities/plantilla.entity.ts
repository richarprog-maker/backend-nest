import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum TipoPlantilla {
    PRIMER_CONTACTO = 'PRIMER_CONTACTO',
    RECUPERACION_1H = 'RECUPERACION_1H',
    RECUPERACION_8H = 'RECUPERACION_8H',
    RECUPERACION_24H = 'RECUPERACION_24H'
}

@Entity('tbl_plantillas_mensajes')
export class PlantillaMensaje {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    nombre: string;

    @Column({
        type: 'enum',
        enum: TipoPlantilla,
        default: TipoPlantilla.PRIMER_CONTACTO
    })
    tipo: TipoPlantilla;

    @Column('text')
    contenido: string;

    @Column({ type: 'json', nullable: true })
    parametros: string[];

    @Column({ default: 'es' })
    idioma: string;

    @Column({ name: 'codigo_empresa', default: 1 })
    codigoEmpresa: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
