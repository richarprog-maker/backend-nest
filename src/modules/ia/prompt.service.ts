import { Injectable } from '@nestjs/common';
import { PROMPT_SYSTEM_MAIN } from './prompts/prompt-main';
import { Lead } from '../inbox/entities/lead.entity';
import { Cita } from '../citas/entities/cita.entity';

@Injectable()
export class PromptService {

    buildSystemPrompt(
        nombreAsistente: string,
        genero: string,
        metadataEmpresa: any[],
        resumenProyectos: string,
        tieneHistorial: boolean = false,
        leadData?: Lead,
        citaData?: Cita
    ): string {

        const listaProyectos = metadataEmpresa
            .map(p => `${p.nombre_proyecto.toUpperCase()}`)
            .join("\n");

        const nombreEmpresa = metadataEmpresa[0]?.nombre_empresa || "Inmobiliaria";
        const instruccionAgendamiento = "Agendamiento 10am-5pm L-D";

        // Instrucción de saludo basada en historial
        const instruccionSaludo = this.buildInstruccionSaludo(tieneHistorial);

        // Construir contexto inteligente del lead
        const metadatosCliente = this.buildMetadatosCliente(leadData);
        const infoCita = this.buildInfoCita(citaData);

        // Construir prompt con reemplazos
        let prompt = PROMPT_SYSTEM_MAIN;
        const replacements: Record<string, string> = {
            "{{nombre_asistente}}": nombreAsistente,
            "{{nombre_empresa}}": nombreEmpresa,
            "{{lista_proyectos}}": listaProyectos,
            "{{resumen_proyectos}}": resumenProyectos,
            "{{instruccion_agendamiento}}": instruccionAgendamiento,
            "{{metadatos_cliente}}": metadatosCliente,
            "{{info_cita}}": infoCita,
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

    private buildMetadatosCliente(lead?: Lead): string {
        if (!lead) return '';

        const campos: string[] = [];

        if (lead.nombre) campos.push(`- Nombre: ${lead.nombre}`);
        if (lead.apellido) campos.push(`- Apellido: ${lead.apellido}`);
        if (lead.dni) campos.push(`- DNI: ${lead.dni}`);
        if (lead.email) campos.push(`- Email: ${lead.email}`);
        if (lead.ciudad) campos.push(`- Ciudad: ${lead.ciudad}`);
        if (lead.telefono) campos.push(`- Teléfono: ${lead.telefono}`);
        if (lead.pais) campos.push(`- País: ${lead.pais}`);
        if (lead.direccion) campos.push(`- Dirección: ${lead.direccion}`);

        if (campos.length === 0) return '';

        return `
## DATOS DEL CLIENTE (YA RECOPILADOS)
Los siguientes datos ya están en nuestro sistema. NO VUELVAS A PEDIRLOS:

${campos.join('\n')}

**IMPORTANTE**: 
- Si necesitas nombre/DNI/email y YA ESTÁN ARRIBA, úsalos directamente, NO preguntes.
- Solo pide datos que NO aparecen en esta lista.
- Si un dato está vacío o no aparece, SÍ puedes preguntarlo.
`;
    }

    private buildInfoCita(cita?: Cita): string {
        if (!cita) return '';

        // Usar zona horaria de Perú para comparaciones correctas
        const ahoraPeru = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
        const hoyISO = `${ahoraPeru.getFullYear()}-${String(ahoraPeru.getMonth() + 1).padStart(2, '0')}-${String(ahoraPeru.getDate()).padStart(2, '0')}`;
        const fechaCita = new Date(`${cita.fechaCita}T${cita.horaCita}`);
        const esFutura = fechaCita > ahoraPeru;

        // Calcular etiqueta legible de la fecha
        const tomorrowPeru = new Date(ahoraPeru);
        tomorrowPeru.setDate(tomorrowPeru.getDate() + 1);
        const mananaISO = `${tomorrowPeru.getFullYear()}-${String(tomorrowPeru.getMonth() + 1).padStart(2, '0')}-${String(tomorrowPeru.getDate()).padStart(2, '0')}`;

        let etiquetaFecha = cita.fechaCita; // fallback: fecha ISO
        if (cita.fechaCita === hoyISO) {
            etiquetaFecha = 'HOY';
        } else if (cita.fechaCita === mananaISO) {
            etiquetaFecha = 'MAÑANA';
        } else if (cita.fechaCita < hoyISO) {
            etiquetaFecha = `${cita.fechaCita} (YA PASÓ)`;
        }

        // Solo citas activas (pendiente/confirmada) y futuras se muestran como "programada"
        const citaActiva = cita.estadoCita === 'pendiente' || cita.estadoCita === 'confirmada';

        if (esFutura && citaActiva) {
            return `
## CITA PROGRAMADA ACTIVA
El cliente YA TIENE UNA CITA AGENDADA:
- Fecha: ${etiquetaFecha} (${cita.fechaCita})
- Hora: ${cita.horaCita}
- Tipo: ${cita.tipoCita || 'No especificado'}
- Estado: ${cita.estadoCita}
${cita.observacion ? `- Observación: ${cita.observacion}` : ''}

**INSTRUCCIÓN**: 
- NO ofrezcas agendar otra cita (ya tiene una)
- Si pregunta por su cita, dile que es ${etiquetaFecha} a las ${cita.horaCita}
`;
        } else {
            // Cita pasada o cancelada/realizada
            return `
## HISTORIAL DE CITAS
- Tuvo una cita el ${cita.fechaCita} a las ${cita.horaCita} (estado: ${cita.estadoCita}) — YA PASÓ.
- NO la menciones como futura. Puedes ofrecer agendar una NUEVA si muestra interés.
`;
        }
    }
}
