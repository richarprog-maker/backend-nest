
require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'richar12#',
    database: process.env.DB_NAME || 'db_checorv2',
    port: Number(process.env.DB_PORT) || 3306,
    multiStatements: true
};

async function migrate() {
    let connection;
    try {
        console.log('--- Iniciando Migración: Empresas y Proyectos ---');
        connection = await mysql.createConnection(dbConfig);

        // 1. Crear Tbl Empresas
        console.log('1. Creando tbl_empresas...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS tbl_empresas (
                id_empresa INT AUTO_INCREMENT PRIMARY KEY,
                id_usuario_admin INT,
                nombre VARCHAR(100) NOT NULL,
                estado INT DEFAULT 1,
                telefono VARCHAR(20),
                email VARCHAR(100),
                direccion VARCHAR(255),
                ciudad VARCHAR(100),
                pais VARCHAR(100),
                logo_url VARCHAR(255),
                web_url VARCHAR(255),
                redes_sociales JSON,
                descripcion TEXT,
                slogan TEXT,
                rubro VARCHAR(100),
                configuracion_json JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            );
        `);

        // 2. Insertar Checor Data
        console.log('2. Insertando datos de Checor...');
        const sqlEmpresa = `
            INSERT INTO tbl_empresas (id_empresa, id_usuario_admin, nombre, estado, telefono, email, direccion, ciudad, pais, logo_url, web_url, redes_sociales, descripcion, slogan, rubro, configuracion_json)
            VALUES (1, 1, 'Checor', 1, '', '', '', 'Lima', '', '', 'https://checor.com/', ?, 'Somos una inmobiliaria y constructora con más de 20 años de experiencia en el desarrollo, construcción y venta de departamentos en Lima.', 'Checor es una marca cercana y confiable, que acompaña a las personas en el proceso de comprar su primer departamento.', '', NULL)
            ON DUPLICATE KEY UPDATE nombre=VALUES(nombre), redes_sociales=VALUES(redes_sociales), descripcion=VALUES(descripcion), slogan=VALUES(slogan), web_url=VALUES(web_url);
        `;
        const redesSociales = JSON.stringify({
            "tiktok": "https://www.tiktok.com/@vidarqinmobiliaria",
            "youtube": "https://www.youtube.com/@vidarqinmobiliaria",
            "facebook": "https://www.facebook.com/vidarqinmobiliaria/?locale=es_LA",
            "linkedin": "https://pe.linkedin.com/company/constructora-e-inmobiliaria-vidarq",
            "whatsapp": "981 281 601",
            "instagram": "https://www.instagram.com/vidarqinmobiliaria/"
        });
        await connection.query(sqlEmpresa, [redesSociales]);

        // 3. Crear Tbl Proyectos
        console.log('3. Creando tbl_proyectos...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS tbl_proyectos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                codigo_empresa INT NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                descripcion TEXT,
                tipo_inmueble VARCHAR(50) DEFAULT 'Departamento',
                ubicacion VARCHAR(200),
                precio_desde DECIMAL(12,2),
                moneda VARCHAR(10) DEFAULT 'USD',
                estado VARCHAR(20) DEFAULT 'activo',
                sperant_project_id INT,
                json_data JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            );
        `);

        // 4. Insertar Proyecto Los Lirios
        console.log('4. Insertando Proyecto Los Lirios...');
        await connection.query(`
            INSERT INTO tbl_proyectos (id, codigo_empresa, nombre, tipo_inmueble, sperant_project_id) 
            VALUES (1, 1, 'Los Lirios', 'Flat', 1) 
            ON DUPLICATE KEY UPDATE nombre=VALUES(nombre), tipo_inmueble=VALUES(tipo_inmueble);
        `);

        console.log('--- Migración Exitosa ---');

    } catch (error) {
        console.error('Error en migración:', error);
    } finally {
        if (connection) await connection.end();
    }
}

migrate();
