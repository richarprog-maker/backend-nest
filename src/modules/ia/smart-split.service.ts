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
Tu misión es recibir un texto y dividirlo en "burbujas" (mensajes separados) para que la lectura sea fluida y natural, COMO SI LO ESCRIBIERA UN HUMANO.

REGLAS DE ORO PARA DIVIDIR:
1.  **Separa SIEMPRE la pregunta final o el Call to Action (CTA)**. La última frase que invita al usuario a responder DEBE ir sola (ej: "¿Te interesa alguna?").
2.  **MANTÉN JUNTAS LAS LISTAS (CRÍTICO)**. Si el texto contiene una lista de opciones, inmuebles, horarios o ítems numerados, **NUNCA** los separes en mensajes distintos. La lista completa debe ir en UNA sola burbuja para que el usuario pueda hacer referencia a ella fácilmente.
    *   CORRECTO: ["Aquí las opciones:", "1. Opción A\n2. Opción B\n3. Opción C", "¿Cuál prefieres?"]
    *   INCORRECTO: ["1. Opción A", "2. Opción B"...]
3.  **Agrupa por contexto**:
    *   Saludo + Introducción -> Burbuja 1
    *   Cuerpo del mensaje / Lista de datos -> Burbuja 2
    *   Pregunta cierre -> Burbuja 3
4.  **NO alteres el texto**: Mantén el contenido EXACTO, solo divide.

Formato de respuesta (JSON):
json
{
  "messages": [
    "Claro, te muestro las opciones. 👍",
    "Estas son las opciones de 2 dormitorios:\n1. Unidad 101 - $100k\n2. Unidad 202 - $110k",
    "¿Cuál de estas te interesa más?"
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
