import { Injectable } from '@nestjs/common';
import { PROMPT_SYSTEM_MAIN } from './prompts/prompt-main';

@Injectable()
export class PromptService {

    buildSystemPrompt(
        nombreAsistente: string,
        genero: string,
        metadataEmpresa: any[],
        resumenProyectos: string
    ): string {

        const listaProyectos = metadataEmpresa
            .map(p => `📌 ${p.nombre_proyecto.toUpperCase()}`)
            .join("\n");

        const nombreEmpresa = metadataEmpresa[0]?.nombre_empresa || "Inmobiliaria";
        const instruccionAgendamiento = "Agendamiento 10am-5pm L-D";

        // Metadatos mínimos del cliente (extender según necesidad)
        const metadatosCliente = "";

        // Usar siempre el prompt principal (Clean Code)
        let prompt = PROMPT_SYSTEM_MAIN;
        const replacements = {
            "{{nombre_asistente}}": nombreAsistente,
            "{{nombre_empresa}}": nombreEmpresa,
            "{{lista_proyectos}}": listaProyectos,
            "{{resumen_proyectos}}": resumenProyectos,
            "{{instruccion_agendamiento}}": instruccionAgendamiento,
            "{{metadatos_cliente}}": metadatosCliente
        };

        for (const [key, value] of Object.entries(replacements)) {
            prompt = prompt.replace(new RegExp(key, 'g'), value);
        }
        return prompt;
    }
}
