const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || 'richar12#', // Fallback from config file I saw
        database: process.env.DB_NAME || 'db_autom_inkav2'
    };

    console.log('Conectando a BD...', config.host, config.database);

    let connection;
    try {
        connection = await mysql.createConnection(config);

        console.log('Aplicando migraciones...');

        // 1. Columnas en tbl_leads
        try {
            await connection.query("ALTER TABLE tbl_leads ADD COLUMN direccion VARCHAR(255) NULL");
            console.log('✅ ALTER tbl_leads ADD direccion');
        } catch (e) { console.log('⚠️ direccion ya existe o error:', e.message); }

        try {
            await connection.query("ALTER TABLE tbl_leads ADD COLUMN fecha_nacimiento DATE NULL");
            console.log('✅ ALTER tbl_leads ADD fecha_nacimiento');
        } catch (e) { console.log('⚠️ fecha_nacimiento ya existe o error:', e.message); }

        try {
            await connection.query("ALTER TABLE tbl_leads ADD COLUMN genero VARCHAR(50) NULL");
            console.log('✅ ALTER tbl_leads ADD genero');
        } catch (e) { console.log('⚠️ genero ya existe o error:', e.message); }

        // 2. Columna en tbl_prospectos
        try {
            await connection.query("ALTER TABLE tbl_prospectos ADD COLUMN origen_id INT NULL");
            console.log('✅ ALTER tbl_prospectos ADD origen_id');
        } catch (e) { console.log('⚠️ origen_id ya existe o error:', e.message); }

        // 3. Crear tbl_origenes_datos
        try {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS tbl_origenes_datos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    nombre VARCHAR(50) NOT NULL UNIQUE
                )
            `);
            console.log('✅ CREATE tbl_origenes_datos');

            await connection.query(`INSERT IGNORE INTO tbl_origenes_datos (id, nombre) VALUES (1, 'Excel'), (2, 'Sperant'), (3, 'WhatsApp')`);
            console.log('✅ SEED tbl_origenes_datos');
        } catch (e) { console.error('❌ Error tbl_origenes_datos:', e.message); }

        // 4. Crear tbl_contexto_lead
        try {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS tbl_contexto_lead (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    lead_uuid VARCHAR(36) NOT NULL,
                    codigo_empresa INT NOT NULL,
                    nombre_completo VARCHAR(200),
                    proyectos_interes JSON DEFAULT NULL,
                    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_lead_empresa (lead_uuid, codigo_empresa)
                )
            `);
            console.log('✅ CREATE tbl_contexto_lead');
        } catch (e) { console.error('❌ Error tbl_contexto_lead:', e.message); }

        console.log('Migración finalizada.');
    } catch (err) {
        console.error('Error Fatal:', err);
    } finally {
        if (connection) await connection.end();
    }
}

migrate();
