import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('tbl_mensajes')
export class Mensaje {
    @PrimaryGeneratedColumn({ name: 'id_mensaje' })
    id: number;

    @Column({ name: 'lead_uuid', nullable: true })
    leadUuid: string;

    @Column({ name: 'id_usuario', nullable: true })
    idUsuario: number;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'id_emisor_tipo' })
    idEmisorTipo: number;
    // 1=Prospecto, 2=Bot, 3=Asesor, 4=Vendedor, 5=Sistema

    @Column({ type: 'text' })
    contenido: string;

    @Column({ name: 'fecha_envio', type: 'datetime', nullable: true })
    fechaEnvio: Date;

    @Column({ name: 'fecha_recibido', type: 'datetime', nullable: true })
    fechaRecibido: Date;

    @Column({ name: 'fecha_creacion', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
    fechaCreacion: Date;

    @Column({ name: 'numero_telefono', nullable: true })
    numeroTelefono: string;

    @Column({ name: 'url_multimedia', nullable: true })
    urlMultimedia: string;

    @Column({ name: 'tipo_multimedia', nullable: true })
    tipoMultimedia: string;

    @Column({ name: 'estado_mensaje', nullable: true })
    estadoMensaje: string; // enviado, entregado, visto, fallido

    @Column({ type: 'tinyint', default: 0 })
    leido: number;

    @Column({ name: 'wamid_msg', nullable: true })
    wamidMsg: string;

    @Column({ name: 'conversacion_facturable', type: 'tinyint', default: 0 })
    conversacionFacturable: number;

    @Column({ name: 'error_wapi', type: 'json', nullable: true })
    errorWapi: any;
}
