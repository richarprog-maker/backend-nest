/**
 * Script para Corregir Conversaciones Facturables
 * 
 * Este script recalcula y actualiza el campo conversacion_facturable para todos los mensajes.
 * 
 * Lógica de Meta/WhatsApp Business:
 * - Una "conversación" se abre cuando el negocio (Bot) envía un mensaje
 * - La conversación dura 24 horas desde ese PRIMER mensaje
 * - Si pasan 24h sin que el negocio envíe mensajes, la siguiente respuesta abre una NUEVA conversación
 * - Solo los mensajes del Bot (id_emisor_tipo = 2) cuentan como facturables
 * 
 * Uso: npx ts-node scripts/corregir-conversaciones-facturables.ts
 */

import * as mysql from 'mysql2/promise';

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'richar12#',
    database: process.env.DB_NAME || 'db_checorv2',
};

interface Mensaje {
    id_mensaje: number;
    lead_uuid: string;
    id_emisor_tipo: number;
    fecha_creacion: Date;
    conversacion_facturable: number;
}

async function main() {
    console.log('='.repeat(80));
    console.log('🔧 CORRECCIÓN DE CONVERSACIONES FACTURABLES');
    console.log('='.repeat(80));
    console.log(`\n📅 Fecha actual: ${new Date().toISOString()}`);

    const connection = await mysql.createConnection(DB_CONFIG);

    try {
        // 1. Primero, reseteamos todos los conversacion_facturable a 0
        console.log('\n📌 Paso 1: Reseteando todos los mensajes a conversacion_facturable = 0...');
        await connection.execute(`UPDATE tbl_mensajes SET conversacion_facturable = 0`);
        console.log('   ✅ Todos los mensajes reseteados.');

        // 2. Obtener todos los leads únicos que tienen mensajes del Bot
        console.log('\n📌 Paso 2: Obteniendo leads con mensajes del Bot...');
        const [leads] = await connection.execute<any[]>(`
            SELECT DISTINCT lead_uuid 
            FROM tbl_mensajes 
            WHERE id_emisor_tipo = 2
            ORDER BY lead_uuid
        `);
        console.log(`   📊 Encontrados ${leads.length} leads con mensajes del Bot.`);

        let totalFacturablesActualizados = 0;

        // 3. Para cada lead, recalcular las ventanas de 24h
        console.log('\n📌 Paso 3: Recalculando ventanas de 24h para cada lead...\n');

        for (const lead of leads) {
            const leadUuid = lead.lead_uuid;

            // Obtener SOLO los mensajes del Bot ordenados por fecha
            // La ventana de 24h se cuenta desde el primer mensaje del Bot en una sesión
            const [mensajesBot] = await connection.execute<any[]>(`
                SELECT id_mensaje, fecha_creacion
                FROM tbl_mensajes
                WHERE lead_uuid = ?
                AND id_emisor_tipo = 2
                ORDER BY fecha_creacion ASC
            `, [leadUuid]);

            if (mensajesBot.length === 0) continue;

            // La lógica correcta:
            // - El PRIMER mensaje del Bot es siempre facturable
            // - Un mensaje del Bot es facturable si pasaron >24h desde el ÚLTIMO mensaje del Bot
            let ultimaFechaMensajeBot: Date | null = null;
            let ventanasEncontradas = 0;
            const mensajesAMarcar: number[] = [];

            for (const msg of mensajesBot) {
                const fechaActual = new Date(msg.fecha_creacion);

                if (!ultimaFechaMensajeBot) {
                    // Primer mensaje del Bot = Facturable
                    mensajesAMarcar.push(msg.id_mensaje);
                    ventanasEncontradas++;
                    ultimaFechaMensajeBot = fechaActual;
                } else {
                    const diffMs = fechaActual.getTime() - ultimaFechaMensajeBot.getTime();
                    const diffHoras = diffMs / (1000 * 60 * 60);

                    if (diffHoras > 24) {
                        // Nueva ventana de 24h = Facturable
                        mensajesAMarcar.push(msg.id_mensaje);
                        ventanasEncontradas++;
                    }
                    // Siempre actualizar la última fecha del Bot
                    ultimaFechaMensajeBot = fechaActual;
                }
            }

            // Marcar los mensajes como facturables
            if (mensajesAMarcar.length > 0) {
                const placeholders = mensajesAMarcar.map(() => '?').join(',');
                await connection.execute(
                    `UPDATE tbl_mensajes SET conversacion_facturable = 1 WHERE id_mensaje IN (${placeholders})`,
                    mensajesAMarcar
                );
                totalFacturablesActualizados += mensajesAMarcar.length;

                console.log(`   Lead ${leadUuid.substring(0, 8)}...: ${ventanasEncontradas} ventana(s) facturable(s)`);
            }
        }

        // 4. Resumen
        console.log('\n' + '='.repeat(80));
        console.log('📈 RESUMEN:');
        console.log('='.repeat(80));
        console.log(`   Leads procesados: ${leads.length}`);
        console.log(`   Total mensajes marcados como facturables: ${totalFacturablesActualizados}`);

        // 5. Verificación final
        const [verificacion] = await connection.execute<any[]>(`
            SELECT 
                COUNT(*) as total_facturables,
                COUNT(DISTINCT lead_uuid) as leads_con_facturables
            FROM tbl_mensajes 
            WHERE conversacion_facturable = 1
        `);

        console.log(`\n📊 Verificación final:`);
        console.log(`   Total mensajes con conversacion_facturable = 1: ${verificacion[0].total_facturables}`);
        console.log(`   Leads distintos con al menos 1 facturable: ${verificacion[0].leads_con_facturables}`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await connection.end();
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Corrección completada');
    console.log('='.repeat(80));
}

main().catch(console.error);
