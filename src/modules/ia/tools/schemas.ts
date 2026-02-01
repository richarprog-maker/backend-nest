import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// Definición de esquemas para las herramientas de la IA

export const agendarCitaSchema = z.object({
    nombre_proyecto: z.string().describe("Nombre del proyecto de interés"),
    nombre_cliente: z.string().optional(),
    apellido_cliente: z.string().optional(),
    fecha_cita: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato AAAA-MM-DD").describe("Fecha deseada para la cita"),
    hora_cita: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM").describe("Hora deseada (24h)"),
    tipo_cita: z.enum(['presencial', 'virtual']).default('presencial'),
    correo_electronico: z.string().email().optional(),
});

export const buscarInfoSchema = z.object({
    nombre_proyecto: z.string(),
    queries_de_busqueda: z.array(z.string()).describe("Lista de preguntas o temas a buscar en la base de conocimiento"),
});

export const enviarBrochureSchema = z.object({
    nombre_proyecto: z.string(),
});

export const enviarMapaSchema = z.object({
    nombre_proyecto: z.string(),
    unidad_id: z.string().describe("Identificador de la unidad"),
});

export const buscarInmuebleSchema = z.object({
    dormitorios: z.number().optional(),
    precio_max: z.number().optional(),
    vista: z.enum(['interior', 'exterior', 'calle', 'parque']).optional(),
});

export const validarDniSchema = z.object({
    dni: z.string().regex(/^\d{8}$/, "El DNI debe tener 8 dígitos"),
});

export const buscarPorCuotaSchema = z.object({
    cuota_mensual: z.number().describe("Monto máximo o aproximado de cuota mensual"),
    dormitorios: z.number().optional(),
    plazo_anos: z.number().optional().default(20),
});

export const generarProformaSchema = z.object({
    nombre_proyecto: z.string(),
    unidad_id: z.string().describe("Identificador exacto de la unidad (ej: 501)"),
    nombre_cliente: z.string(),
    dni_cliente: z.string(),
    ocupacion_cliente: z.string(),
    ingresos_cliente: z.string().or(z.number()),
});

export const mostrarDepartamentosSchema = z.object({
    nombre_proyecto: z.string().optional(),
    dormitorios: z.number().optional().describe("Cantidad de dormitorios filtrados"),
    piso: z.number().optional(),
});

export const enviarVideosProyectoSchema = z.object({
    nombre_proyecto: z.string().describe("Nombre del proyecto inmobiliario"),
});
