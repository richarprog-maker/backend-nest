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
        citaData?: Cita,
        proyectoId?: number,
        resumenSesion?: string
    ): string {

        const listaProyectos = metadataEmpresa
            .map(p => `${p.nombre_proyecto.toUpperCase()}`)
            .join("\n");

        const nombreEmpresa = metadataEmpresa[0]?.nombre_empresa || "Inmobiliaria";
        const instruccionAgendamiento = "Agendamiento 10am-5pm L-D";

        const instruccionSaludo = this.buildInstruccionSaludo(tieneHistorial);

        const metadatosCliente = this.buildMetadatosCliente(leadData);
        const infoCita = this.buildInfoCita(citaData);

        const instruccionProyecto = this.buildInstruccionProyecto(metadataEmpresa, proyectoId);
        const datosFlujo = this.buildDatosFlujo(resumenSesion);

        let prompt = PROMPT_SYSTEM_MAIN;
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
            - Este cliente YA tiene conversación previa contigo.
            - **PROHIBIDO** decir "Hola", "Hola, claro", "Hola, aquí tienes", "Hola, como estas" o cualquier saludo.
            - **PROHIBIDO** empezar mensajes con "Hola," seguido de información.
            - **PROHIBIDO** usar emojis de saludo como 👋.
            - Ve DIRECTO al punto, el cliente ya te conoce.
            - Si el cliente dice "Hola" o te contacta después de tiempo, NO preguntes "En qué te ayudo".
            - En su lugar, revisa el historial y retoma el flujo en el paso donde se quedaron de forma proactiva.
            - Empieza directo: "Continuando con la búsqueda de tu depa..." o "Retomando lo que conversábamos..." seguido del paso pendiente.`;
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
        if (lead.dni) campos.push(`- DNI: ${lead.dni}`);
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
    private buildDatosFlujo(resumenSesion?: string): string {
        if (!resumenSesion || !resumenSesion.trim()) return '';

        // Detectar que datos tiene el resumen
        const tiene = (patron: RegExp) => patron.test(resumenSesion);

        const tieneDormitorios = tiene(/dormitorio/i);
        const tieneProposito = tiene(/prop.?sito|para vivir|inversi.?n/i);
        const tieneZona = tiene(/zona preferida/i);
        const tienetiempoCompra = tiene(/tiempo de compra/i);
        const tieneFinanciamiento = tiene(/financiamiento/i);
        const tienePresupuesto = tiene(/presupuesto|cuota/i);
        const tieneNombre = tiene(/identificado/i);
        const tieneDni = tiene(/dni capturado/i);
        const tieneOcupacion = tiene(/ocupaci.?n/i);
        const tieneIngresos = tiene(/ingresos mensuales/i);
        const tieneProforma = tiene(/cotiz.?|proforma/i);

        // Determinar paso pendiente
        let pasoPendiente = 1;
        if (!tieneDormitorios) pasoPendiente = 1;
        else if (!tieneProposito || !tieneZona) pasoPendiente = 2;
        else if (!tienetiempoCompra) pasoPendiente = 3;
        else if (!tieneFinanciamiento) pasoPendiente = 4;
        else if (!tienePresupuesto) pasoPendiente = 5;
        else if (!tieneNombre || !tieneDni) pasoPendiente = 8;
        else if (!tieneOcupacion || !tieneIngresos) pasoPendiente = 9;
        else if (!tieneProforma) pasoPendiente = 9;
        else pasoPendiente = 11;

        // Si ya tiene todo hasta paso 5 inclusive, desde paso 6 buscar depa
        if (tieneDormitorios && tieneProposito && tieneZona && tienetiempoCompra && tieneFinanciamiento && tienePresupuesto && pasoPendiente < 6) {
            pasoPendiente = 6;
        }

        return `
## DATOS DE FASES PREVIAS (PORTABLES ENTRE PROYECTOS)
Este cliente ya respondio las siguientes preguntas en proyectos anteriores. Son VALIDOS para el proyecto actual:

${resumenSesion}

**INSTRUCCION CRITICA**:
- NO vuelvas a preguntar ninguno de los datos que aparecen arriba.
- Los datos de dormitorios, proposito, zona, tiempo de compra, financiamiento y presupuesto son validos para cualquier proyecto.
- Los datos de unidad especifica, proforma y cita son del proyecto anterior y pueden necesitar actualizacion.
- Continua directamente desde el **PASO ${pasoPendiente}** del flujo.
- Si el paso pendiente es 6 o mas, busca departamentos en el nuevo proyecto usando los dormitorios que ya tienes.
`;
    }
}
