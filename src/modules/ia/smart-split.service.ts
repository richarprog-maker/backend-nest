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
- SOLO divide el texto existente, NUNCA lo modifiques ni le añadas nada

# REGLAS PARA DIVIDIR:
1.  **Separa la pregunta final o CTA**. La última frase que invita al usuario a responder DEBE ir sola en su propia burbuja.
2.  **MANTÉN LA LISTA DE UNIDADES/ITEMS EN UN SOLO MENSAJE (CRÍTICO)**.
    - Si hay opciones numeradas (1., 2., 3...) o con viñetas, DEBEN ir TODAS JUNTAS en el mismo bloque.
    - JAMÁS separes "1. Unidad X" en un mensaje y "2. Unidad Y" en otro.
    - El bloque de la lista debe incluir la frase introductoria si es corta (ej: "Aquí las opciones:").
3.  Si el texto ya tiene un saludo, agrúpalo con la siguiente frase. Si NO tiene saludo, NO inventes uno.
4.  El resultado debe contener EXACTAMENTE las mismas palabras que el texto original, solo dividido.

# EJEMPLO (solo si el texto original YA contiene estas palabras):
Texto original: "Ya te envié el brochure. Aquí están las opciones: 1. Unidad A 2. Unidad B. ¿Cuál prefieres?"
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
