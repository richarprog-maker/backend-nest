import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tbl_ia_token_log')
@Index(['leadUuid', 'codigoEmpresa'])
@Index(['fase'])
@Index(['createdAt'])
export class IaTokenLog {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'lead_uuid', type: 'varchar', length: 36, nullable: true })
    leadUuid?: string;

    @Column({ name: 'codigo_empresa', type: 'int', nullable: true })
    codigoEmpresa?: number;

    @Column({ type: 'varchar', length: 40 })
    fase: string;

    @Column({ name: 'nombre_modelo', type: 'varchar', length: 60, default: 'gpt-4o-mini' })
    nombreModelo: string;

    @Column({ name: 'tkn_input', type: 'int', default: 0 })
    tknInput: number;

    @Column({ name: 'tkn_output', type: 'int', default: 0 })
    tknOutput: number;

    @Column({ type: 'json', nullable: true })
    metadatos?: any;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
