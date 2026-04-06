# Sync de Inventario desde Redshift

Este flujo deja lista una fuente alternativa de inventario para `tbl_unidades_proyectos` sin tocar la importación actual de Excel y sin ejecutar Qdrant.

## Archivos

- `scripts/sql/redshift-unidades-inventario.sql`: consulta fuente en el warehouse.
- `scripts/sync-unidades-redshift.js`: preview o carga manual hacia MySQL local.

## Variables requeridas

El script lee `backend-nest/.env` de forma explícita.

- `REDSHIFT_URL` o `CHECOR_WAREHOUSE_URL`
- `REDSHIFT_SCHEMA` o `CHECOR_WAREHOUSE_SCHEMA` (default: `checor`)
- Variables MySQL existentes: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`

## Ejecución

Preview seguro:

```bash
node scripts/sync-unidades-redshift.js
```

Escritura local en `tbl_unidades_proyectos`:

```bash
node scripts/sync-unidades-redshift.js --write
```

Filtrar uno o varios proyectos:

```bash
node scripts/sync-unidades-redshift.js --write --project="Los Lirios"
node scripts/sync-unidades-redshift.js --write --project="Los Lirios,Porta 360"
```

## Alcance actual

- Proyectos por defecto: `Los Lirios`, `Porta 360`, `Los Cerezos`
- Se reemplazan las unidades locales del proyecto al escribir
- No ejecuta `sync-unidades-qdrant.js`
- No modifica el flujo actual de importación por Excel
- Normaliza `tipo de inmueble` a valores como `Flat`, `Dúplex`, `Estacionamiento`
- Normaliza `nro de unidad` dejando solo números cuando vienen prefijos como `LIR-202`
