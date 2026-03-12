export function convertGoogleDriveToDirectUrl(driveUrl: string): string | null {
    if (!driveUrl || !driveUrl.includes('drive.google.com')) {
        return null;
    }

    const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
        const fileId = match[1];
        return `https://drive.google.com/uc?export=view&id=${fileId}`;
    }

    return null;
}

export function formatMonto(valor: string | number | undefined): string {
    if (!valor) {
        return 'N/A';
    }

    const num = typeof valor === 'string' ? parseFloat(valor.replace(/[^\d.]/g, '')) : valor;
    if (isNaN(num)) {
        return String(valor);
    }

    return `S/ ${num.toLocaleString('es-PE')}`;
}
