# Webhook SPERANT - Checor

## URL del webhook

SPERANT debe enviar los eventos de leads a esta URL:

```text
https://checor.novalyapp.com/api/webhook/sperant/1
```

## Método HTTP

```text
POST
```

## Eventos esperados

Actualmente el webhook procesa estos eventos:

- `client_created`
- `client_digital`

## Autenticación

Por el momento este webhook no requiere token en headers ni autenticación adicional.



## Reglas del payload

- El campo `event_name` es obligatorio.
- El objeto `client` es obligatorio.
- `created_at` puede llegar como `number` o `string`.
- `last_interaction_at` puede llegar como `number` o `string`.
- `person_type_id` puede llegar como `string` o `number`.
- `seller_id` puede llegar en el nivel superior o dentro de `last_interaction_project`.

## Ejemplo de payload válido

```json
{
  "client": {
    "id": 14867,
    "created_at": 1745530560,
    "fname": "Juan Roberto Zapata",
    "lname": "",
    "person_type_id": "natural",
    "gender": "m",
    "document_type_name": "DNI",
    "document": "auto-575968",
    "phone": "",
    "email": "jrobertozapata@gmail.com",
    "last_interaction_at": 1745530678,
    "observation": "",
    "last_interaction_project": {
      "project_id": 71,
      "interest_type_name": "alto",
      "captation_way": "a donde vivir",
      "input_channel_name": "contacto web",
      "seller_id": 5
    },
    "project_id": 71,
    "interest_type_name": "alto",
    "captation_way": "a donde vivir",
    "input_channel_name": "contacto web",
    
  },
  "event_name": "client_created",
  "current_user_id": 5,
  "token": ""
}

```

## Respuesta esperada

Si el webhook fue recibido correctamente, responderá:

```json
{
  "status": "ok",
  "correlation_id": "uuid-generado",
  "evento_id": 123
}
```
