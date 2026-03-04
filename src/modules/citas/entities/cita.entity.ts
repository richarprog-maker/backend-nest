import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tbl_citas')
export class Cita {
    @PrimaryGeneratedColumn({ name: 'id_cita' })
    id: number;

    @Column({ name: 'lead_uuid', nullable: true })
    leadUuid: string;

    @Column({ name: 'codigo_empresa' })
    codigoEmpresa: number;

    @Column({ name: 'id_vendedor', nullable: true })
    idVendedor: number;

    @Column({
        name: 'fecha_cita',
        type: 'date',
        transformer: {
            // Al leer de la BD: Convertir Date a string YYYY-MM-DD
            from: (value: Date | string): string => {
                if (!value) return null;
                if (typeof value === 'string') return value;

                // Si es Date, extraer solo YYYY-MM-DD sin problemas de timezone
                const year = value.getFullYear();
                const month = String(value.getMonth() + 1).padStart(2, '0');
                const day = String(value.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            },
            // Al guardar en la BD: Pasar el string tal cual (MySQL lo maneja)
            to: (value: string): string => value
        }
    })
    fechaCita: string;

    @Column({ name: 'hora_cita', type: 'time' })
    horaCita: string;

    @Column({ name: 'tipo_cita', nullable: true })
    tipoCita: string; // 'presencial' | 'virtual'

    @Column({ name: 'estado_cita', default: 'pendiente' })
    estadoCita: string; // pendiente, confirmada, cancelada, realizada

    @Column({ name: 'proyecto_id', nullable: true })
    proyectoId: number;

    @Column({ name: 'nombre_proyecto', length: 100, nullable: true })
    nombreProyecto: string;

    @Column({ type: 'text', nullable: true })
    observacion: string;

    @CreateDateColumn({ name: 'fecha_creacion' })
    fechaRegistro: Date;

    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    fechaActualizacion: Date;
}
