import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum CanalNotificacionAsesor {
    WHATSAPP = 'WHATSAPP',
    EMAIL = 'EMAIL',
}

export enum EventoNotificacionAsesor {
    CITA_LEAD_CALIENTE = 'CITA_LEAD_CALIENTE',
}

@Entity('tbl_plantillas_notificaciones_asesores')
export class PlantillaNotificacionAsesor {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column()
    nombre: string;

    @Column({
        type: 'enum',
        enum: CanalNotificacionAsesor,
    })
    canal: CanalNotificacionAsesor;

    @Column({
        type: 'enum',
        enum: EventoNotificacionAsesor,
    })
    evento: EventoNotificacionAsesor;

    @Column({ nullable: true })
    asunto: string;

    @Column('text')
    contenido: string;

    @Column({ name: 'nombre_template_whatsapp', nullable: true })
    nombreTemplateWhatsapp: string;

    @Column({ type: 'json', nullable: true })
    parametros: string[];

    @Column({ default: 'es_PE' })
    idioma: string;

    @Column({ default: true })
    activo: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
