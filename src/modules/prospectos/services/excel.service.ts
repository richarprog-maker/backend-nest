import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

@Injectable()
export class ServicioExcel {

    leerBuffer(buffer: Buffer): any[] {
        try {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];

            const data = XLSX.utils.sheet_to_json(sheet);

            if (!data || data.length === 0) {
                throw new BadRequestException('El archivo Excel está vacío o no tiene datos legibles.');
            }

            return this.normalizarCabeceras(data);
        } catch (error) {
            console.error('Error al leer Excel:', error);
            throw new BadRequestException('Formato de archivo inválido o corrupto.');
        }
    }

    generarPlantilla(): Buffer {
        const cabeceras = [
            'fname', 'lname', 'phone', 'email', 'document', 'address', 'gender', 'date_of_birth',
            'country', 'department', 'city', 'project_id', 'asesor_id', 'utm_source', 'utm_medium', 'utm_campaign', 'observacion'
        ];

        const ejemplo = [
            {
                fname: 'Juan', lname: 'Perez', phone: '51999888777', email: 'juan@example.com',
                document: '12345678', address: 'Av. Siempre Viva 123', gender: 'Masculino', date_of_birth: '1990-01-01',
                country: 'Peru', department: 'Lima', city: 'Miraflores', project_id: '1', asesor_id: '12',
                utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'verano_2026', observacion: 'Interesado en el proyecto X'
            }
        ];

        const ws = XLSX.utils.json_to_sheet(ejemplo, { header: cabeceras });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Plantilla Importacion");

        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }

    private normalizarCabeceras(data: any[]): any[] {
        return data.map(row => {
            const newRow: any = {};
            for (const key in row) {
                if (Object.prototype.hasOwnProperty.call(row, key)) {
                    // Normalizar clave: minusculas, sin espacios extremos
                    const cleanKey = key.trim().toLowerCase()
                        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar acentos
                        .replace(/\s+/g, "_"); // Espacios a guiones bajos

                    newRow[cleanKey] = row[key];
                }
            }
            return newRow;
        });
    }
}
