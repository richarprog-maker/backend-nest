import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('tbl_sincronizaciones_citas_sperant')
@Index(['codigoEmpresa', 'idCitaLocal'])
export class SincronizacionCitaSperant {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'codigo_empresa', type: 'int' })
    codigoEmpresa: number;

    @Column({ name: 'id_cita_local', type: 'int', nullable: true })
    idCitaLocal: number | null;

    @Column({ name: 'lead_uuid', type: 'varchar', length: 36 })
    leadUuid: string;

    @Column({ name: 'cliente_id_sperant', type: 'int' })
    clienteIdSperant: number;

    @Column({ name: 'evento_id_sperant', type: 'int', nullable: true })
    eventoIdSperant: number | null;

    @Column({ name: 'proyecto_id_local', type: 'int', nullable: true })
    proyectoIdLocal: number | null;

    @Column({ name: 'proyecto_id_sperant', type: 'int', nullable: true })
    proyectoIdSperant: number | null;

    @Column({ type: 'varchar', length: 30, default: 'pendiente' })
    estado: string;

    @Column({ name: 'payload_request', type: 'json', nullable: true })
    payloadRequest: any;

    @Column({ name: 'payload_response', type: 'json', nullable: true })
    payloadResponse: any;

    @Column({ name: 'error_ultimo', type: 'text', nullable: true })
    errorUltimo: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
