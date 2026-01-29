const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || 'richar12#',
        database: process.env.DB_NAME || 'db_checorv2'
    };

    console.log('Conectando a BD...', config.host, config.database);

    let connection;
    try {
        connection = await mysql.createConnection(config);

        console.log('Versión de BD:', config.database);

        // Agregar columna tema a tbl_preguntas_frecuentes
        try {
            await connection.query("ALTER TABLE tbl_preguntas_frecuentes ADD COLUMN tema VARCHAR(100) NULL AFTER tipo");
            console.log('✅ ALTER tbl_preguntas_frecuentes ADD tema');
        } catch (e) {
            if (e.message.includes('Duplicate column')) {
                console.log('⚠️ Columna tema ya existe.');
            } else {
                console.error('❌ Error agregando columna tema:', e.message);
            }
        }

    } catch (err) {
        console.error('Error Fatal:', err);
    } finally {
        if (connection) await connection.end();
    }
}

migrate();
