import { Injectable } from '@nestjs/common';
import { PROMPT_SYSTEM_MAIN } from './prompts/prompt-main';

@Injectable()
export class PromptService {

    buildSystemPrompt(
        nombreAsistente: string,
        genero: string,
        metadataEmpresa: any[],
        resumenProyectos: string,
        tieneHistorial: boolean = false
    ): string {

        const listaProyectos = metadataEmpresa
            .map(p => `${p.nombre_proyecto.toUpperCase()}`)
            .join("\n");

        const nombreEmpresa = metadataEmpresa[0]?.nombre_empresa || "Inmobiliaria";
        const instruccionAgendamiento = "Agendamiento 10am-5pm L-D";

        // Instrucción de saludo basada en historial
        const instruccionSaludo = this.buildInstruccionSaludo(tieneHistorial);

        // Metadatos mínimos del cliente
        const metadatosCliente = "";

        // Construir prompt con reemplazos
        let prompt = PROMPT_SYSTEM_MAIN;
        const replacements: Record<string, string> = {
            "{{nombre_asistente}}": nombreAsistente,
            "{{nombre_empresa}}": nombreEmpresa,
            "{{lista_proyectos}}": listaProyectos,
            "{{resumen_proyectos}}": resumenProyectos,
            "{{instruccion_agendamiento}}": instruccionAgendamiento,
            "{{metadatos_cliente}}": metadatosCliente,
            "{{instruccion_saludo}}": instruccionSaludo
        };

        for (const [key, value] of Object.entries(replacements)) {
            prompt = prompt.replace(new RegExp(key, 'g'), value);
        }
        return prompt;
    }

    /**
     * Genera la instrucción de saludo según si hay historial previo
     */
    private buildInstruccionSaludo(tieneHistorial: boolean): string {
        if (tieneHistorial) {
            return `
            ## PROHIBIDO SALUDAR (HAY HISTORIAL PREVIO)
            - Este cliente YA tiene conversación previa contigo.
            - **PROHIBIDO** decir "Hola", "Hola, claro", "Hola, aquí tienes", "Hola, como estas" o cualquier saludo.
            - **PROHIBIDO** empezar mensajes con "Hola," seguido de información.
            - **PROHIBIDO** usar emojis de saludo como 👋.
            - Ve DIRECTO al punto, el cliente ya te conoce.
            - Si el cliente dice "Hola", responde: "Claro, dime" o "En que te ayudo" SIN saludar de vuelta.
            - Cuando des información, empieza directo: "Esta es la info..." o "Aquí están los datos..." SIN "Hola".`;
        }
        
        return `
            ## PRIMER CONTACTO
            - Este es el PRIMER mensaje del cliente.
            - Puedes saludarlo UNA sola vez con tu presentación.
            - Después de este mensaje, NO vuelvas a saludar.`;
    }
}
