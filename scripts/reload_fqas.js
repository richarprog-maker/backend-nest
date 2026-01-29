const mysql = require('mysql2/promise');
require('dotenv').config();

async function reload() {
    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || 'richar12#',
        database: process.env.DB_NAME || 'db_checorv2'
    };

    let connection;
    try {
        console.log('Conectando a BD...');
        connection = await mysql.createConnection(config);

        console.log('Truncando tabla tbl_preguntas_frecuentes...');
        await connection.query('TRUNCATE TABLE tbl_preguntas_frecuentes');

        console.log('Insertando datos con temas...');
        const sql = `
            INSERT INTO tbl_preguntas_frecuentes (uuid, id_proyecto, tipo, tema, orden, pregunta, respuesta) VALUES 
            (UUID(), 1, 'Pregunta Frecuente', 'Ubicación', 1, '¿Donde se encuentra ubicado el proyecto Los Lirios?', 'Av. Petit Thouars 1737, Lince'),
            (UUID(), 1, 'Pregunta Frecuente', 'Departamentos', 2, '¿Qué tipos de departamentos ofrece?', 'Tenemos flats y dúplex'),
            (UUID(), 1, 'Pregunta Frecuente', 'Ubicación', 3, '¿Qué servicios cercanos hay (supermercados, bancos, colegios, parques)?', 'Está rodeado de tiendas, restaurantes, bancos y servicios esenciales. A pocos minutos se encuentran el Parque Castilla y el Parque del Bombero. En la zona destacan colegios como Saco Oliveros, Christa McAuliffe y Santa Rosa de Lima.'),
            (UUID(), 1, 'Pregunta Frecuente', 'Inversión', 4, '¿Cómo es la valorización de la zona? ¿Los departamentos en Lince se revalorizan rápido?', 'Lince es uno de los distritos con mayor demanda por su cercanía a San Isidro. Los departamentos suelen revalorizarse bien, sobre todo en zonas cercanas a avenidas principales como Petit Thouars. La zona atrae inversión inmobiliaria constante.'),
            (UUID(), 1, 'Pregunta Frecuente', 'Áreas Comunes', 5, '¿Cuales son sus áreas comunes?', 'Lobby, coworking, gym, bike parking, sala lounge y terraza'),
            (UUID(), 1, 'Pregunta Frecuente', 'Acabados', 6, '¿Cuál es el tipo de acabados que tendrá el departamento?', NULL), 
            (UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 7, '¿Cuotas mensuales de los departamentos?', 'Cuota de 1 dormitorio desde 1460 soles y cuota de 2 dormitorios desde 2255 soles'),
            (UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 8, '¿Cuentan con desembolso postergado?', 'No contamos con desembolso postergado'),
            (UUID(), 1, 'Pregunta Frecuente', 'Entrega', 9, '¿Cual es su fecha de entrega?', 'Su fecha de entrega es en diciembre 2026'),
            (UUID(), 1, 'Pregunta Frecuente', 'Proyecto', 10, '¿Cuántos pisos y departamentos tiene el proyecto?', 'Tiene 17 pisos y 95 departamentos'),
            (UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 11, '¿Cuál es el precio total del departamento?', 'Departamentos de 1 dormitorio con precio desde 291,000 soles y departamentos de 2 dormitorios precio desde 339,000 soles'),
            (UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 12, '¿Cuánto es la separación?', 'Se puede separar con 1500 soles'),
            (UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 13, '¿Qué bancos trabajan con el proyecto?', 'Se puede financiar con el banco BCP'),
            (UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 14, '¿Puedo financiar directamente con la inmobiliaria?', 'Sí contamos con la modalidad de crédito directo. ¿Te gustaría agendar una cita para poder conversar sobre las posibilidades de financiamiento que tenemos disponible?'),
            (UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 15, '¿Qué requisitos pide el banco para un crédito hipotecario?', 'Debes contar con un historial crediticio y procurar mantener uno bueno: pagar tus tarjetas y/o deudas adicionales en la fecha de pago, no sobreendeudarte, poder sustentar ingresos suficientes.'),
            (UUID(), 1, 'Pregunta Frecuente', 'Financiamiento', 16, '¿El proyecto aplica al Bono del Buen Pagador o al Nuevo Crédito Mivivienda?', 'Sí, el proyecto aplica al Bono del Buen Pagador y al Nuevo Crédito Mivivienda. Esto permite acceder a cuotas más accesibles y tasas preferenciales.'),
            (UUID(), 1, 'Pregunta Frecuente', 'Entrega', 17, '¿Es entrega inmediata?', 'No, el proyecto se encuentra a punto de iniciar obra.'),
            (UUID(), 1, 'Pregunta Frecuente', 'Departamentos', 18, '¿Cuántos dormitorios tiene?', 'El proyecto cuenta con departamentos flat de 1 y 2 dormitorios y dúplex de 3 dormitorios.'),
            (UUID(), 1, 'Pregunta Frecuente', 'Obra', 19, '¿Ya inició obra?', 'No, el proyecto iniciará obra a inicios de diciembre.'),
            (UUID(), 1, 'Objeción Frecuente', 'Obra', 1, 'No han inciado obra aún', 'Iniciaremos obra a inicios de diciembre 2025.'),
            (UUID(), 1, 'Objeción Frecuente', 'Departamentos', 2, 'Los departamentos de 1 dorm son muy chicos', 'Tenemos un proyecto muy cercano a Lirios con depas de 1 dorm desde 40m2');
        `;

        await connection.query(sql);
        console.log('✅ Datos insertados correctamente.');

    } catch (err) {
        console.error('Error Fatal:', err);
    } finally {
        if (connection) await connection.end();
    }
}

reload();
