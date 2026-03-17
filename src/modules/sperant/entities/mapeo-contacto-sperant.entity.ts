import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('tbl_mapeos_contactos_sperant')
@Index(['codigoEmpresa', 'clienteIdSperant'], { unique: true })
@Index(['codigoEmpresa', 'leadUuid'], { unique: true })
export class MapeoContactoSperant {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'codigo_empresa', type: 'int' })
    codigoEmpresa: number;

    @Column({ name: 'lead_id', type: 'int' })
    leadId: number;

    @Column({ name: 'lead_uuid', type: 'varchar', length: 36 })
    leadUuid: string;

    @Column({ name: 'cliente_id_sperant', type: 'int' })
    clienteIdSperant: number;

    @Column({ type: 'varchar', length: 30, nullable: true })
    documento: string | null;

    @Column({ type: 'varchar', length: 150, nullable: true })
    email: string | null;

    @Column({ type: 'varchar', length: 30, nullable: true })
    telefono: string | null;

    @Column({ type: 'varchar', length: 30, default: 'activo' })
    estado: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
