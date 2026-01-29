import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('tbl_historial_chat_ai')
@Index(['leadUuid', 'codigoEmpresa'])
@Index(['leadUuid', 'role'])
@Index(['createdAt'])
export class HistorialChatAi {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'lead_uuid', type: 'varchar', length: 36 })
    leadUuid: string;

    @Column({ name: 'codigo_empresa', type: 'int' })
    codigoEmpresa: number;

    @Column({ type: 'json' })
    input: any;

    @Column({ type: 'varchar', length: 20 })
    role: string;

    @Column({ name: 'tkn_input', type: 'int', default: 0 })
    tknInput: number;

    @Column({ name: 'tkn_output', type: 'int', default: 0 })
    tknOutput: number;

    @Column({ name: 'nombre_modelo', type: 'varchar', length: 50, default: 'gpt-4o-mini' })
    nombreModelo: string;

    @Column({ type: 'json', nullable: true })
    metadatos: any;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
