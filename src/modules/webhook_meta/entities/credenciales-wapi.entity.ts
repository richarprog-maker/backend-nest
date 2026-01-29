import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('tbl_crendenciales_wapi') // Nota: Mantiene el nombre de tabla del script SQL (con 'crendenciales')
export class CredencialesWapi {
    @PrimaryGeneratedColumn({ name: 'id_credential' })
    id: number;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'wapi_token', type: 'text', nullable: true })
    wapiToken: string;

    @Column({ name: 'wapi_phone_id', nullable: true })
    wapiPhoneId: string;

    @Column({ name: 'wapi_business_id', nullable: true })
    wapiBusinessId: string;

    @Column({ name: 'app_id', nullable: true })
    appId: string;

    @Column({ name: 'verify_token', nullable: true })
    verifyToken: string;

    @Column({ name: 'estado', default: 1 })
    estado: number;
}
