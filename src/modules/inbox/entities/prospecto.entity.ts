import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Lead } from './lead.entity';

@Entity('tbl_prospectos')
export class Prospecto {
    @PrimaryGeneratedColumn({ name: 'id_prospecto' })
    id: number;

    @Column({ name: 'id_lead' })
    idLead: number;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    // Detalles del Interés
    @Column({ name: 'interes_tipo_id', nullable: true })
    interesTipoId: number; // ID Proyecto

    @Column({ name: 'interes_nombre', nullable: true })
    interesNombre: string; // Nombre Proyecto

    @Column({ name: 'origen_dato', nullable: true })
    origenDato: string; // Excel, Web, Facebook, Organico (Legacy)

    @Column({ name: 'origen_id', nullable: true })
    origenId: number;


    // Estado del Embudo
    @Column({ name: 'estado_gestion', default: 'nuevo' })
    estadoGestion: string; // nuevo, contactado, cita, cierre, no_interesado

    @Column({ type: 'text', nullable: true })
    observacion: string;

    @Column({ type: 'json', nullable: true })
    json_data: any; // Data cruda extra

    // Contador de campañas enviadas para estadísticas
    @Column({ name: 'contador_campanias', default: 0 })
    contadorCampanias: number;

    @ManyToOne(() => Lead, (lead) => lead.prospectos)
    @JoinColumn({ name: 'id_lead' })
    lead: Lead;

    @CreateDateColumn({ name: 'fecha_registro' })
    fechaRegistro: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    fechaActualizacion: Date;
}
