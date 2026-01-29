import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_empresas')
export class Empresa {
    @PrimaryGeneratedColumn({ name: 'id_empresa' })
    id: number;

    @Column({ name: 'id_usuario_admin', nullable: true })
    idUsuarioAdmin: number;

    @Column({ name: 'nombre' })
    nombre: string;

    @Column({ name: 'estado', default: 1 })
    estado: number;

    // Datos de Contacto
    @Column({ name: 'telefono', nullable: true })
    telefono: string;

    @Column({ name: 'email', nullable: true })
    email: string;

    @Column({ name: 'direccion', nullable: true })
    direccion: string;

    @Column({ name: 'ciudad', nullable: true })
    ciudad: string;

    @Column({ name: 'pais', nullable: true })
    pais: string;

    // Branding
    @Column({ name: 'logo_url', nullable: true })
    logoUrl: string;

    @Column({ name: 'web_url', nullable: true })
    webUrl: string;

    @Column({ type: 'json', name: 'redes_sociales', nullable: true })
    redesSociales: any;

    @Column({ type: 'text', nullable: true })
    descripcion: string;

    @Column({ type: 'text', nullable: true })
    slogan: string;

    @Column({ name: 'rubro', nullable: true })
    rubro: string;

    @Column({ type: 'json', name: 'configuracion_json', nullable: true })
    configuracionJson: any;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
