SELECT
    p.nombre AS proyecto_nombre,
    p.codigo AS proyecto_codigo,
    p.direccion AS proyecto_direccion,
    u.tipo_unidad AS tipo_inmueble,
    u.codigo AS nro_unidad,
    u.nombre_tipologia AS tipologia,
    u.piso AS nro_piso,
    CAST(u.total_habitaciones AS VARCHAR) || ' dormitorios' AS nro_dormitorios,
    vista.valor AS vista,
    u.area_techada AS area_techada,
    u.area_libre AS area_libre,
    u.area_total AS area_total,
    u.precio_lista AS precio_lista,
    u.moneda_precio_lista AS moneda_lista,
    u.estado_comercial AS disponibilidad,
    descuento.valor AS descuento_promocional,
    promo.valor AS promocion_mes,
    tiempo.valor AS tiempo_promocion,
    plano.url AS enlace_plano,
    plano.nombre AS nombre_archivo,
    plano.montaje AS montaje_archivo,
    plano.codigo_proforma AS codigo_proforma_archivo
FROM __SCHEMA__.proyectos p
INNER JOIN __SCHEMA__.unidades u
    ON u.codigo_proyecto = p.codigo
LEFT JOIN __SCHEMA__.datos_extras vista
    ON vista.codigo = u.codigo
   AND vista.tipo = 'UNIDAD'
   AND vista.nombre = 'Vista'
LEFT JOIN __SCHEMA__.datos_extras descuento
    ON descuento.codigo = u.codigo
   AND descuento.tipo = 'UNIDAD'
   AND descuento.nombre = 'Descuento Promocional'
LEFT JOIN __SCHEMA__.datos_extras promo
    ON promo.codigo = u.codigo
   AND promo.tipo = 'UNIDAD'
   AND promo.nombre = 'Precio promocional o promoción del mes'
LEFT JOIN __SCHEMA__.datos_extras tiempo
    ON tiempo.codigo = u.codigo
   AND tiempo.tipo = 'UNIDAD'
   AND tiempo.nombre = 'Tiempo de la promoción'
LEFT JOIN __SCHEMA__.archivos plano
    ON plano.codigo_proforma = u.codigo_proforma
WHERE p.nombre IN (__PROJECT_NAMES__)
ORDER BY p.nombre, u.piso, u.codigo;
