// Esquemas de entrada del vertical de clientes (T5c).
//
// El body es el schema COMPARTIDO (`clientSchema` de `@gestion/shared`): el mismo que valida el
// formulario del frontend, asi que las reglas de RUC/DNI/CE y de correos no se duplican (S8 del
// doc padre). Lo que el schema compartido no puede decidir es la identidad: no hay `owner_id`
// ni `is_client` entre los campos, porque el dueno sale de la sesion y el rol de cliente lo
// fija el servicio (un alta por esta ruta nunca crea un proveedor suelto).
import { clientSchema } from "@gestion/shared";
import { z } from "zod";

const uuid = z.string().uuid("El identificador debe ser un uuid.");

/** Body de `POST /entities` y `PATCH /entities/:id`: el contrato compartido del formulario. */
export const clientBodySchema = clientSchema;

export type ClientBody = z.output<typeof clientBodySchema>;

/** Parametro de ruta de las escrituras por id. */
export const entityIdParamsSchema = z.object({ id: uuid });

export type EntityIdParams = z.output<typeof entityIdParamsSchema>;
