import axios from 'axios';

const FACEBOOK_GRAPH_API_URL = 'https://graph.facebook.com/v24.0';
const WHATSAPP_BUSINESS_ACCOUNT_ID = '4190761261187914';
const WHATSAPP_ACCESS_TOKEN = 'EAAKexqb42G0BROW6TV7zBxZAZC3PVDotoWoHJbCXlTz9pSnPrTUtBgWSaPGs5ZANaPAfwsOh1emS9wNywQwDGPnFcLMng6o53cdb6GaimiQFCWokANZCu66sYUzdfkJ2pZBnVwHxDXZAzgScd2pOMh6FQhLrK9Remfk13eTzTCZCHV6vuOZAlZAVlrQbCPiofPAZDZD';
const DEFAULT_TEMPLATE_NAME = 'campania_asesor_resumen_v2';
const DEFAULT_LANGUAGE = 'es_PE';
const DEFAULT_CATEGORY = 'MARKETING';

function ObtenerNombrePlantilla(): string {
    return (process.argv[2] || DEFAULT_TEMPLATE_NAME).trim().toLowerCase();
}

function ObtenerPayloadMeta(NombrePlantilla: string): Record<string, unknown> {
    return {
        name: NombrePlantilla,
        language: DEFAULT_LANGUAGE,
        category: DEFAULT_CATEGORY,
        components: [
            {
                type: 'BODY',
                text: [
                    '📢 Hola {{1}},',
                    '',
                    'Se ha generado una nueva notificación que requiere tu atención.',
                    '',
                    '{{2}}',
                    '',
                    'Por favor, revisa el detalle y continua con la gestion correspondiente.',
                ].join('\n'),
                example: {
                    body_text: [[
                        'Marketing 2',
                        'Lead: Samy Recuay\nTelefono: 51935456579\nProyecto: Los Cerezos\nFecha: 2026-06-05\nHora: 16:00',
                    ]],
                },
            },
        ],
    };
}

async function Main(): Promise<void> {
    const NombrePlantilla = ObtenerNombrePlantilla();
    const Payload = ObtenerPayloadMeta(NombrePlantilla);
    const Url = `${FACEBOOK_GRAPH_API_URL}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;

    console.log(JSON.stringify(Payload, null, 2));

    const Respuesta = await axios.post(Url, Payload, {
        headers: {
            Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    });

    console.log(JSON.stringify(Respuesta.data, null, 2));
}

Main().catch((ErrorScript) => {
    const ErrorMeta = ErrorScript.response?.data
        ? JSON.stringify(ErrorScript.response.data, null, 2)
        : ErrorScript.message;
    console.error(ErrorMeta);
    process.exit(1);
});
