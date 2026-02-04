/**
 * Script de Análisis de Conversaciones Facturables
 * 
 * Analiza la conversación de un lead específico para verificar:
 * 1. Todos los mensajes ordenados por fecha
 * 2. Qué mensajes tienen conversacion_facturable = 1
 * 3. Si la lógica de 24h está funcionando correctamente
 * 4. Identificar problemas potenciales
 * 
 * Uso: npx ts-node scripts/analizar-conversacion-facturable.ts
 */

import * as mysql from 'mysql2/promise';

// Configuración de BD (usar variables de entorno en producción)
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'richar12#',
    database: process.env.DB_NAME || 'db_checorv2',
};

// Lead UUID a analizar
const LEAD_UUID = '53b5f79a-dfeb-4884-b9c9-04ac60212ab7';

interface Mensaje {
    id_mensaje: number;
    lead_uuid: string;
    id_emisor_tipo: number;
    contenido: string;
    conversacion_facturable: number;
    fecha_envio: Date | null;
    fecha_recibido: Date | null;
    fecha_creacion: Date;
    estado_mensaje: string;
}

async function main() {
    console.log('='.repeat(80));
    console.log('🔍 ANÁLISIS DE CONVERSACIÓN FACTURABLE');
    console.log('='.repeat(80));
    console.log(`\n📌 Lead UUID: ${LEAD_UUID}`);
    console.log(`📅 Fecha actual: ${new Date().toISOString()}`);
    console.log('\n');

    const connection = await mysql.createConnection(DB_CONFIG);

    try {
        // 1. Obtener todos los mensajes del lead ordenados por fecha
        const [mensajes] = await connection.execute<any[]>(`
            SELECT 
                id_mensaje,
                lead_uuid,
                id_emisor_tipo,
                LEFT(contenido, 100) as contenido,
                conversacion_facturable,
                fecha_envio,
                fecha_recibido,
                fecha_creacion,
                estado_mensaje
            FROM tbl_mensajes
            WHERE lead_uuid = ?
            ORDER BY fecha_creacion ASC
        `, [LEAD_UUID]);

        console.log(`📊 Total de mensajes encontrados: ${mensajes.length}\n`);

        if (mensajes.length === 0) {
            console.log('❌ No se encontraron mensajes para este lead.');
            return;
        }

        // 2. Mostrar resumen de mensajes
        console.log('-'.repeat(80));
        console.log('📨 LISTA DE MENSAJES:');
        console.log('-'.repeat(80));

        const tipoEmisor: Record<number, string> = {
            1: 'Lead/Cliente',
            2: 'Bot',
            3: 'Asesor',
            4: 'Vendedor',
            5: 'Sistema'
        };

        let totalFacturables = 0;
        let ultimoMensajeNegocio: any = null;
        const problemas: string[] = [];

        for (const msg of mensajes) {
            const fecha = msg.fecha_envio || msg.fecha_recibido || msg.fecha_creacion;
            const esFacturable = msg.conversacion_facturable === 1;
            const esNegocio = msg.id_emisor_tipo !== 1;

            if (esFacturable) totalFacturables++;

            // Icono según tipo
            let icono = '👤'; // Lead
            if (msg.id_emisor_tipo === 2) icono = '🤖'; // Bot
            if (msg.id_emisor_tipo === 3) icono = '👨‍💼'; // Asesor

            console.log(`${icono} [${msg.id_mensaje}] ${fecha.toISOString()}`);
            console.log(`   Tipo: ${tipoEmisor[msg.id_emisor_tipo] || 'Desconocido'} | Facturable: ${esFacturable ? '✅ SÍ' : '❌ NO'}`);
            console.log(`   Contenido: ${msg.contenido}...`);

            // Análisis de lógica 24h
            if (esNegocio) {
                if (ultimoMensajeNegocio) {
                    const fechaAnterior = new Date(ultimoMensajeNegocio.fecha_envio || ultimoMensajeNegocio.fecha_creacion);
                    const fechaActual = new Date(msg.fecha_envio || msg.fecha_creacion);
                    const diffMs = fechaActual.getTime() - fechaAnterior.getTime();
                    const diffHoras = diffMs / (1000 * 60 * 60);

                    console.log(`   ⏱️  Diferencia con último mensaje negocio: ${diffHoras.toFixed(2)} horas`);

                    // Verificar si debería ser facturable
                    if (diffHoras > 24 && !esFacturable) {
                        problemas.push(`Mensaje ${msg.id_mensaje}: Pasaron ${diffHoras.toFixed(2)}h pero NO está marcado como facturable`);
                    } else if (diffHoras <= 24 && esFacturable && msg.id_mensaje !== mensajes.find(m => m.id_emisor_tipo !== 1)?.id_mensaje) {
                        // No es el primer mensaje del negocio
                        problemas.push(`Mensaje ${msg.id_mensaje}: Solo pasaron ${diffHoras.toFixed(2)}h pero SÍ está marcado como facturable`);
                    }
                } else {
                    // Es el primer mensaje del negocio
                    if (!esFacturable) {
                        problemas.push(`Mensaje ${msg.id_mensaje}: Es el PRIMER mensaje del negocio pero NO está marcado como facturable`);
                    }
                    console.log(`   🆕 Primer mensaje del negocio para este lead`);
                }
                ultimoMensajeNegocio = msg;
            }
            console.log('');
        }

        // 3. Resumen
        console.log('='.repeat(80));
        console.log('📈 RESUMEN:');
        console.log('='.repeat(80));
        console.log(`   Total mensajes: ${mensajes.length}`);
        console.log(`   Mensajes del Lead: ${mensajes.filter(m => m.id_emisor_tipo === 1).length}`);
        console.log(`   Mensajes del Bot: ${mensajes.filter(m => m.id_emisor_tipo === 2).length}`);
        console.log(`   Mensajes del Asesor: ${mensajes.filter(m => m.id_emisor_tipo === 3).length}`);
        console.log(`   Total FACTURABLES: ${totalFacturables}`);
        console.log('');

        // 4. Verificar ventanas de 24h
        console.log('='.repeat(80));
        console.log('🔎 ANÁLISIS DE VENTANAS DE 24 HORAS:');
        console.log('='.repeat(80));

        const mensajesNegocio = mensajes.filter(m => m.id_emisor_tipo !== 1);

        if (mensajesNegocio.length > 0) {
            let ventanas = 1; // Primera ventana
            let inicioVentana = new Date(mensajesNegocio[0].fecha_envio || mensajesNegocio[0].fecha_creacion);

            console.log(`\n   Ventana 1: Inicio ${inicioVentana.toISOString()}`);

            for (let i = 1; i < mensajesNegocio.length; i++) {
                const fechaMsg = new Date(mensajesNegocio[i].fecha_envio || mensajesNegocio[i].fecha_creacion);
                const diffHoras = (fechaMsg.getTime() - inicioVentana.getTime()) / (1000 * 60 * 60);

                if (diffHoras > 24) {
                    ventanas++;
                    inicioVentana = fechaMsg;
                    console.log(`   Ventana ${ventanas}: Inicio ${inicioVentana.toISOString()} (después de ${diffHoras.toFixed(2)}h de inactividad)`);
                }
            }

            console.log(`\n   📊 Total de ventanas/conversaciones que DEBERÍAN ser facturables: ${ventanas}`);
            console.log(`   📊 Total REALMENTE marcadas como facturables en BD: ${totalFacturables}`);

            if (ventanas !== totalFacturables) {
                console.log(`\n   ⚠️  DISCREPANCIA DETECTADA: Deberían ser ${ventanas} pero hay ${totalFacturables}`);
            } else {
                console.log(`\n   ✅ Los números coinciden correctamente.`);
            }
        }

        // 5. Problemas encontrados
        if (problemas.length > 0) {
            console.log('\n');
            console.log('='.repeat(80));
            console.log('⚠️  PROBLEMAS ENCONTRADOS:');
            console.log('='.repeat(80));
            problemas.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
        }

        // 6. Query de estadísticas que usa el dashboard
        console.log('\n');
        console.log('='.repeat(80));
        console.log('📊 VERIFICACIÓN QUERY DEL DASHBOARD:');
        console.log('='.repeat(80));

        const [statsRows] = await connection.execute<any[]>(`
            SELECT 
                DATE_FORMAT(COALESCE(fecha_envio, fecha_recibido), '%Y-%m') AS anio_mes,
                COUNT(*) AS total_conversaciones_facturables
            FROM tbl_mensajes
            WHERE 
                lead_uuid = ?
                AND conversacion_facturable = 1
            GROUP BY DATE_FORMAT(COALESCE(fecha_envio, fecha_recibido), '%Y-%m')
            ORDER BY anio_mes
        `, [LEAD_UUID]);

        console.log('\n   Resultado del query de estadísticas para este lead:');
        statsRows.forEach(row => {
            console.log(`   ${row.anio_mes}: ${row.total_conversaciones_facturables} conversación(es) facturable(s)`);
        });

        // 7. Verificar mensajes con fechas NULL
        const [nullDates] = await connection.execute<any[]>(`
            SELECT id_mensaje, fecha_envio, fecha_recibido, fecha_creacion
            FROM tbl_mensajes
            WHERE lead_uuid = ?
            AND fecha_envio IS NULL AND fecha_recibido IS NULL
        `, [LEAD_UUID]);

        if (nullDates.length > 0) {
            console.log('\n   ⚠️  Mensajes con fecha_envio Y fecha_recibido NULL:');
            nullDates.forEach(row => {
                console.log(`      ID: ${row.id_mensaje}, fecha_creacion: ${row.fecha_creacion}`);
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await connection.end();
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Análisis completado');
    console.log('='.repeat(80));
}

main().catch(console.error);
