import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tbl_origenes_datos')
export class OrigenDato {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    nombre: string;
}
