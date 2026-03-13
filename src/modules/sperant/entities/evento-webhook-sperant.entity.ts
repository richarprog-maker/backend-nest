import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('tbl_eventos_webhook_sperant')
@Index(['codigoEmpresa', 'llaveIdempotencia'], { unique: true })
export class EventoWebhookSperant {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'codigo_empresa', type: 'int' })
    codigoEmpresa: number;

    @Column({ name: 'tipo_evento', type: 'varchar', length: 80 })
    tipoEvento: string;

    @Column({ name: 'cliente_id_sperant', type: 'int', nullable: true })
    clienteIdSperant: number | null;

    @Column({ name: 'llave_idempotencia', type: 'varchar', length: 128 })
    llaveIdempotencia: string;

    @Column({ name: 'correlation_id', type: 'varchar', length: 100 })
    correlationId: string;

    @Column({ type: 'json' })
    payload: any;

    @Column({ type: 'varchar', length: 30, default: 'pendiente' })
    estado: string;

    @Column({ type: 'int', default: 0 })
    intentos: number;

    @Column({ name: 'lead_uuid', type: 'varchar', length: 36, nullable: true })
    leadUuid: string | null;

    @Column({ name: 'error_ultimo', type: 'text', nullable: true })
    errorUltimo: string | null;

    @Column({ name: 'procesado_at', type: 'datetime', nullable: true })
    procesadoAt: Date | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
