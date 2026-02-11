import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

@Injectable()
export class SmartSplitService {
    private readonly logger = new Logger(SmartSplitService.name);
    private chatModel: ChatOpenAI;

    private readonly systemPrompt = `
Eres un experto en UX conversacional para WhatsApp.
Tu misión es recibir un texto y dividirlo en "burbujas" (mensajes separados) para que la lectura sea fluida y natural.

# REGLA FUNDAMENTAL (MÁXIMA PRIORIDAD)
**JAMÁS INVENTES o AGREGUES contenido que NO esté en el texto original.**
- NO agregues saludos ("Hola", "Buenos días", "Espero que estés bien", etc.)
- NO agregues emojis que no estén en el original
- NO agregues frases de cortesía ("Claro", "Por supuesto", etc.) si no están
- SOLO divide el texto existente, NUNCA lo modifices ni le añadas nada

# REGLAS PARA DIVIDIR:
1.  **Separa la pregunta final o CTA**. La última frase que invita al usuario a responder DEBE ir sola en su propia burbuja.

2.  **MANTÉN LISTAS Y DETALLES JUNTOS (CRÍTICO - NUNCA SEPARES)**.
    - Si hay opciones numeradas (1., 2., 3...), TODAS JUNTAS en el mismo bloque.
    - Si hay viñetas con campos de datos (• Dormitorios:, • Área:, • Piso:, • Vista:, • Precio:, etc.), TODAS JUNTAS en el mismo bloque.
    - JAMÁS separes "• Dormitorios: 2" en un mensaje y "• Área: 53m²" en otro.
    - JAMÁS separes "1. Unidad X" en un mensaje y "2. Unidad Y" en otro.
    - Si hay una frase introductoria corta antes de la lista (ej: "Esta es la información de la Unidad 606:"), inclúyela CON la lista en el mismo bloque.

3.  Si el texto ya tiene un saludo, agrúpalo con la siguiente frase. Si NO tiene saludo, NO inventes uno.

4.  El resultado debe contener EXACTAMENTE las mismas palabras que el texto original, solo dividido.

# EJEMPLOS:
Ejemplo 1 - Detalles con viñetas (MANTENER TODO JUNTO):
Texto: "Esta es la información de la Unidad 606: • Dormitorios: 2 • Área total: 53.74 m² • Piso: 6 • Vista: interior • Precio: S/377,000. ¿Te gustaría avanzar con esta unidad?"
json
{
  "messages": [
    "Esta es la información de la Unidad 606:\\n• Dormitorios: 2\\n• Área total: 53.74 m²\\n• Piso: 6\\n• Vista: interior\\n• Precio: S/377,000.",
    "¿Te gustaría avanzar con esta unidad?"
  ]
}

Ejemplo 2 - Lista numerada (MANTENER TODO JUNTO):
Texto: "Ya te envié el brochure. Aquí están las opciones: 1. Unidad A 2. Unidad B. ¿Cuál prefieres?"
json
{
  "messages": [
    "Ya te envié el brochure.",
    "Aquí están las opciones: 1. Unidad A 2. Unidad B.",
    "¿Cuál prefieres?"
  ]
}
`;

    constructor(private configService: ConfigService) {
        this.chatModel = new ChatOpenAI({
            openAIApiKey: this.configService.get<string>('OPENAI_API_KEY'),
            modelName: 'gpt-4o-mini',
            temperature: 0,
            modelKwargs: { response_format: { type: "json_object" } }
        });
    }

    async splitMessage(text: string): Promise<string[]> {

        if (!text) return [""];
        if (text.length < 100) return [text];

        try {
            const response = await this.chatModel.invoke([
                new SystemMessage(this.systemPrompt),
                new HumanMessage(text)
            ]);

            const content = response.content.toString();
            const parsed = JSON.parse(content);

            if (!parsed.messages || !Array.isArray(parsed.messages) || parsed.messages.length === 0) {
                return [text];
            }

            return parsed.messages;
        } catch (error) {
            this.logger.error('Error splitting message, returning original', error);
            return [text];
        }
    }
}
