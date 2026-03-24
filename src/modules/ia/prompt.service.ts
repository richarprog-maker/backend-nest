import { Injectable } from '@nestjs/common';
import { PROMPT_SYSTEM_MAIN } from './prompts/prompt-main';
import { Lead } from '../inbox/entities/lead.entity';
import { Cita } from '../citas/entities/cita.entity';
import { parseSessionSummary, resolvePasoPendiente } from './utils/session-summary.utils';

@Injectable()
export class PromptService {

    buildSystemPrompt(
        nombreAsistente: string,
        genero: string,
        metadataEmpresa: any[],
        resumenProyectos: string,
        tieneHistorial: boolean = false,
        leadData?: Lead,
        citaData?: Cita,
        proyectoId?: number,
        resumenSesion?: string
    ): string {
        const config = this.buildPromptConfig(
            nombreAsistente,
            genero,
            metadataEmpresa,
            resumenProyectos,
            tieneHistorial,
            leadData,
            citaData,
            proyectoId,
            resumenSesion
        );

        return `${config.stablePrompt}\n\n${config.variablePrompt}`;
    }

    buildPromptConfig(
        nombreAsistente: string,
        genero: string,
        metadataEmpresa: any[],
        resumenProyectos: string,
        tieneHistorial: boolean = false,
        leadData?: Lead,
        citaData?: Cita,
        proyectoId?: number,
        resumenSesion?: string
    ): {
        stablePrompt: string;
        variablePrompt: string;
        pasoPendiente: number;
    } {

        const listaProyectos = metadataEmpresa
            .map(p => `${p.nombre_proyecto.toUpperCase()}`)
            .join("\n");

        const nombreEmpresa = metadataEmpresa[0]?.nombre_empresa || "Inmobiliaria";
        const instruccionAgendamiento = "Agendamiento 10am-5pm L-D";

        const instruccionSaludo = this.buildInstruccionSaludo(tieneHistorial);

        const metadatosCliente = this.buildMetadatosCliente(leadData);
        const infoCita = this.buildInfoCita(citaData);

        const instruccionProyecto = this.buildInstruccionProyecto(metadataEmpresa, proyectoId);
        const datosFlujo = this.buildDatosFlujo(resumenSesion, leadData, proyectoId);
        const pasoPendiente = this.resolvePasoPendiente(resumenSesion, citaData, leadData, proyectoId);

        let stablePrompt = PROMPT_SYSTEM_MAIN;
        const replacements: Record<string, string> = {
            "{{nombre_asistente}}": nombreAsistente,
            "{{nombre_empresa}}": nombreEmpresa,
            "{{lista_proyectos}}": listaProyectos,
            "{{resumen_proyectos}}": resumenProyectos,
            "{{instruccion_agendamiento}}": instruccionAgendamiento,
            "{{metadatos_cliente}}": metadatosCliente,
            "{{info_cita}}": infoCita,
            "{{instruccion_saludo}}": instruccionSaludo,
            "{{instruccion_proyecto}}": instruccionProyecto,
            "{{datos_flujo_previo}}": datosFlujo
        };

        for (const [key, value] of Object.entries(replacements)) {
            stablePrompt = stablePrompt.replace(new RegExp(key, 'g'), value);
        }

        return {
            stablePrompt,
            variablePrompt: '',
            pasoPendiente,
        };
    }

    private resolvePasoPendiente(resumenSesion?: string, cita?: Cita, lead?: Lead, proyectoId?: number): number {
        if (this.hasActiveFutureCita(cita)) {
            return 12;
        }

        if (!resumenSesion?.trim()) {
            return 1;
        }

        const contexto = parseSessionSummary(resumenSesion);
        return resolvePasoPendiente(contexto, lead, { proyectoId });
    }

    private isValidDni(dni?: string | null): boolean {
        if (!dni) return false;
        return /^\d{8}$/.test(dni) && dni !== '00000000' && !dni.startsWith('00');
    }

    private hasActiveFutureCita(cita?: Cita): boolean {
        if (!cita) return false;

        const fechaActualPeru = new Date().toLocaleString('en-US', { timeZone: 'America/Lima' });
        const datePeru = new Date(fechaActualPeru);
        const hoyISO = `${datePeru.getFullYear()}-${String(datePeru.getMonth() + 1).padStart(2, '0')}-${String(datePeru.getDate()).padStart(2, '0')}`;
        const horaActualMinutos = datePeru.getHours() * 60 + datePeru.getMinutes();
        const [horaCita, minutoCita] = cita.horaCita.split(':').map(Number);
        const horaCitaMinutos = horaCita * 60 + minutoCita;
        const citaActiva = cita.estadoCita === 'pendiente' || cita.estadoCita === 'confirmada';

        if (!citaActiva) return false;
        if (cita.fechaCita > hoyISO) return true;
        return cita.fechaCita === hoyISO && horaCitaMinutos > horaActualMinutos;
    }

    /**
     * Genera la instrucción de saludo según si hay historial previo
     */
    private buildInstruccionSaludo(tieneHistorial: boolean): string {
        if (tieneHistorial) {
            return `
            - Este cliente YA tiene conversación previa contigo.
            - **PROHIBIDO** decir "Hola", "Hola, claro", "Hola, aquí tienes", "Hola, como estas" o cualquier saludo.
            - **PROHIBIDO** usar emojis de saludo como 👋.
            - Ve DIRECTO al punto sobre lo que el cliente pregunta o el paso del flujo pendiente, de forma natural.
            - Si el cliente te vuelve a escribir tras una pausa y dice "Hola", NO le preguntes "En qué te ayudo". Simplemente revisa el historial y retoma el flujo en el paso donde se quedaron de forma proactiva.
            - **CRÍTICO:** NO repitas frases robotizadas como "Continuando con la búsqueda..." o "Retomando lo que conversábamos...". Varía tus respuestas y hazlas naturales.`;
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

        // Solo pasar nombre REAL del cliente (no el de WhatsApp/Meta)
        if (lead.nombre) campos.push(`- Nombre: ${lead.nombre}`);
        if (lead.apellido) campos.push(`- Apellido: ${lead.apellido}`);
        if (this.isValidDni(lead.dni)) campos.push(`- DNI: ${lead.dni}`);
        if (lead.email) campos.push(`- Email: ${lead.email}`);
        if (lead.ciudad) campos.push(`- Ciudad: ${lead.ciudad}`);
        if (lead.telefono) campos.push(`- Teléfono: ${lead.telefono}`);
        if (lead.pais) campos.push(`- País: ${lead.pais}`);
        if (lead.direccion) campos.push(`- Dirección: ${lead.direccion}`);

        // Si no tiene nombre real, indicar que debe pedirlo
        const necesitaNombre = !lead.nombre;

        if (campos.length === 0 && !necesitaNombre) return '';

        let texto = '';
        if (campos.length > 0) {
            texto += `
## DATOS DEL CLIENTE (YA RECOPILADOS)
Los siguientes datos ya están en nuestro sistema. NO VUELVAS A PEDIRLOS:

${campos.join('\n')}

**IMPORTANTE**: 
- Si necesitas nombre/DNI/email y YA ESTÁN ARRIBA, úsalos directamente, NO preguntes.
- Solo pide datos que NO aparecen en esta lista.
- Si un dato está vacío o no aparece, SÍ puedes preguntarlo.
`;
        }

        if (necesitaNombre) {
            texto += `
## NOMBRE DEL CLIENTE PENDIENTE
- El cliente AÚN NO ha proporcionado su nombre real.
- Cuando llegues al paso de recopilar datos personales, PIDE su nombre completo.
- NO asumas ningún nombre. Pregúntale directamente cómo se llama.
`;
        }

        return texto;
    }

    private buildInfoCita(cita?: Cita): string {
        if (!cita) return '';

        // Usar zona horaria de Perú para comparaciones correctas
        const fechaActualPeru = new Date().toLocaleString('en-US', { timeZone: 'America/Lima' });
        const datePeru = new Date(fechaActualPeru);

        const anio = datePeru.getFullYear();
        const mes = String(datePeru.getMonth() + 1).padStart(2, '0');
        const dia = String(datePeru.getDate()).padStart(2, '0');
        const hoyISO = `${anio}-${mes}-${dia}`;

        const horas = datePeru.getHours();
        const minutos = datePeru.getMinutes();
        const horaActualMinutos = horas * 60 + minutos;

        // Info cita
        const fechaCitaISO = cita.fechaCita; // se asume formato YYYY-MM-DD
        const [hCita, mCita] = cita.horaCita.split(':').map(Number);
        const horaCitaMinutos = hCita * 60 + mCita;

        let esFutura = false;

        // Lógica estricta de comparación
        if (fechaCitaISO > hoyISO) {
            esFutura = true;
        } else if (fechaCitaISO === hoyISO) {
            if (horaCitaMinutos > horaActualMinutos) {
                esFutura = true;
            }
        }

        // Calcular etiqueta legible de la fecha
        const tomorrowPeru = new Date(datePeru);
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
## CITA PROGRAMADA ACTIVA (FUTURA)
El cliente YA TIENE UNA CITA CONFIRMADA:
- Fecha: ${etiquetaFecha} (${cita.fechaCita})
- Hora: ${cita.horaCita}
- Tipo: ${cita.tipoCita || 'No especificado'}
- Estado: ${cita.estadoCita}
${cita.observacion ? `- Observación: ${cita.observacion}` : ''}

**INSTRUCCIÓN**: 
- NO ofrezcas agendar otra cita (ya tiene una).
- Si pregunta por su cita, confírmale que es ${etiquetaFecha} a las ${cita.horaCita}.
`;
        } else {
            // Cita pasada o cancelada/realizada
            return `
## HISTORIAL DE CITAS (CITA VENCIDA / PASADA)
- Tuvo una cita el ${cita.fechaCita} a las ${cita.horaCita} (estado: ${cita.estadoCita}).
- **ESTA CITA YA PASÓ**. NO ES UNA CITA ACTIVA.
- Aunque el estado diga "pendiente", la fecha ya venció.
- **INSTRUCCIÓN CRÍTICA**:
  - NO digas "tienes una cita programada".
  - Asume que la cita ya ocurrió o se perdió.
  - Pregunta: "¿Pudiste asistir a la visita del ${etiquetaFecha}?" o "¿Te gustaría reagendar tu visita?".
`;
        }
    }

    private buildInstruccionProyecto(metadataEmpresa: any[], proyectoId?: number): string {
        const formatHorario = (horarios: any[]) => {
            if (!horarios || horarios.length === 0) return 'Horario no especificado';

            return horarios.map(h => {
                const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
                const inicio = parseInt(h.num_dia_semana_inicio ?? h.dia_inicio ?? 1, 10);
                const fin = parseInt(h.num_dia_semana_fin ?? h.dia_fin ?? 5, 10);
                const diaStr = inicio === fin ? dias[inicio] : `${dias[inicio]} a ${dias[fin]}`;
                return `${diaStr}: ${h.hora_inicio} - ${h.hora_fin}`;
            }).join(', ');
        };

        if (proyectoId) {
            const proyecto = metadataEmpresa.find(p => p.id === proyectoId);
            const nombre = proyecto?.nombre_proyecto || metadataEmpresa[0]?.nombre_proyecto || '';
            const horarioTexto = proyecto?.horario_atencion && proyecto.horario_atencion.length > 0 ? formatHorario(proyecto.horario_atencion) : 'Horario no especificado, consultar disponibilidad';

            const otrosProyectos = metadataEmpresa.filter(p => p.id !== proyectoId);
            const listaOtros = otrosProyectos.length > 0
                ? otrosProyectos.map(p => `- ${p.nombre_proyecto} (Atención: ${formatHorario(p.horario_atencion)})`).join('\n')
                : null;

            return `
## PROYECTO ASIGNADO
- El cliente esta interesado en: **${nombre}**
- Horarios de atención: **${horarioTexto}**
- Usa este proyecto para herramientas OPERATIVAS como buscarDepartamento, cuota, proforma, citas y seguimiento.
- EXCEPCION: si el cliente hace una pregunta frecuente de OTRO proyecto, responde con la info de ese proyecto PERO sin cambiar el proyecto actual.

## CAMBIO DE PROYECTO
${listaOtros ? `Otros proyectos disponibles:\n${listaOtros}` : '(No hay otros proyectos disponibles)'}

**REGLAS DE CAMBIO DE PROYECTO**:
1. Si el cliente pide info, brochure, videos o preguntas de OTRO proyecto: dale lo que pide, PERO NO cambies su proyecto. Despues, PREGUNTA: "Tu proyecto actual es ${nombre}. Te gustaria cambiarte al proyecto [otro]?"
2. SOLO ejecuta guardar_proyecto cuando el cliente confirme EXPLICITAMENTE: "si", "cambienme", "prefiero ese", "me interesa mas ese".
3. Pedir un brochure o info de otro proyecto NO ES confirmar cambio.
4. Cuando guardar_proyecto confirme el cambio, revisa el bloque DATOS DE FASES PREVIAS del contexto. Esos datos son VALIDOS para el nuevo proyecto. NO vuelvas a preguntar nada que ya este ahi. Continua directamente desde el paso pendiente.`;
        }

        if (metadataEmpresa.length > 1) {
            const lista = metadataEmpresa.map((p, i) => `${i + 1}. ${p.nombre_proyecto} (Atención: ${formatHorario(p.horario_atencion)})`).join('\n');
            return `
## SELECCION DE PROYECTO (PASO OBLIGATORIO)
- El cliente AUN NO ha elegido un proyecto.
- ANTES de continuar con cualquier otro paso, pregunta:
  "Tenemos los siguientes proyectos disponibles:\n${lista}\n  Cual te interesa?"
- Una vez que el cliente elija, usa la herramienta guardar_proyecto para registrar su eleccion.
- Despues de guardar el proyecto, continua con el flujo normal.`;
        }

        return '';
    }

    /**
     * Construye el bloque de datos de fases previas a partir del resumen de sesion.
     * Permite que al cambiar de proyecto el bot sepa que pasos ya se completaron.
     */
    private buildDatosFlujo(resumenSesion?: string, leadData?: Lead, proyectoId?: number): string {
        if (!resumenSesion || !resumenSesion.trim()) return '';

        const contexto = parseSessionSummary(resumenSesion);
        const pasoPendiente = resolvePasoPendiente(contexto, leadData, { proyectoId });
        const lineas: string[] = [];

        if (contexto.dormitorios || contexto.proposito || contexto.zonaPreferida || contexto.tiempoCompra || contexto.financiamiento || contexto.presupuesto) {
            lineas.push('### FASE 1 - DESCUBRIMIENTO YA RESPONDIDO');
            if (contexto.dormitorios) lineas.push(`- Paso 1 / Dormitorios: ${contexto.dormitorios}`);
            if (contexto.proposito) lineas.push(`- Paso 2 / Propósito: ${contexto.proposito}`);
            if (contexto.zonaPreferida) lineas.push(`- Paso 2 / Zona preferida: ${contexto.zonaPreferida}`);
            if (contexto.tiempoCompra) lineas.push(`- Paso 3 / Tiempo de compra: ${contexto.tiempoCompra}`);
            if (contexto.financiamiento) lineas.push(`- Paso 4 / Financiamiento: ${contexto.financiamiento}`);
            if (contexto.presupuesto) lineas.push(`- Paso 5 / Presupuesto o cuota: ${contexto.presupuesto}`);
        }

        if (contexto.unidadInteres) {
            lineas.push('### FASE 2 - PRESENTACION');
            lineas.push(`- Paso 6 / Unidad de interés ya mencionada: ${contexto.unidadInteres}`);
        }

        if (contexto.ocupacion || contexto.ingresos || contexto.tieneProforma) {
            lineas.push('### FASE 3 - IDENTIFICACION Y PROFORMA');
            if (contexto.ocupacion) lineas.push(`- Paso 9 / Ocupación capturada: ${contexto.ocupacion}`);
            if (contexto.ingresos) lineas.push(`- Paso 9 / Ingresos mensuales capturados: ${contexto.ingresos}`);
            if (contexto.tieneProforma) lineas.push('- Paso 9 / Ya existe una proforma o cotización previa registrada');
        }

        if (contexto.notasAdicionales.length > 0) {
            lineas.push('### OTRAS NOTAS DE SESION');
            contexto.notasAdicionales.forEach((nota) => lineas.push(`- ${nota}`));
        }

        return `
## DATOS DE FASES PREVIAS (PORTABLES ENTRE PROYECTOS)
Este cliente ya respondio las siguientes preguntas en proyectos anteriores. Son VALIDOS para el proyecto actual:

${lineas.join('\n')}

### PASO PENDIENTE ESTIMADO
- Continúa directamente desde el **PASO ${pasoPendiente}** del flujo.
- Usa este bloque como FUENTE PRINCIPAL de contexto operativo antes de depender del historial corto.

**INSTRUCCION CRITICA**:
- NO vuelvas a preguntar ninguno de los datos que aparecen arriba.
- Los datos de dormitorios, proposito, zona, tiempo de compra, financiamiento y presupuesto son validos para cualquier proyecto.
- El nombre, DNI y email se leen desde DATOS DEL CLIENTE; no los dupliques ni los pidas otra vez si ya están ahí.
- Los datos de unidad especifica, proforma y cita son del proyecto anterior y pueden necesitar actualizacion.
- Si el paso pendiente es 6 o mas, usa primero los datos ya capturados en esta sesion antes de pedirlos otra vez.
- Si el paso pendiente es 6 o mas y ya tienes dormitorios, busca departamentos en el nuevo proyecto usando esos dormitorios.
`;
    }
}
