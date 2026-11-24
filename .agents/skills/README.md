# Skills

Una skill por directorio, con su `SKILL.md`. Son la especificación de dominio: se leen **antes** de
diseñar o tocar el área, no cuando algo ya falló.

| Si el pedido o el diff toca | Leer antes |
| --- | --- |
| Autenticación: `apps/api/src/auth/**`, `apps/web/lib/auth/**`, `apps/web/app/login/**`, sesiones, cookies, cualquier `BETTER_AUTH_*` | `better-auth-best-practices` y `better-auth-security-best-practices` |
| Un flujo de auth nuevo (registro, verificación de email, reset, 2FA, organizaciones) | `create-auth`, más la específica: `email-and-password-best-practices`, `two-factor-authentication-best-practices` u `organization-best-practices` |
| Facturación SUNAT, caja y bancos, cobros y cobranzas | `facturacion-sunat-mype`, `caja-bancos-mype`, `consultor-pagos-cobranzas` |

**Regla de auth, sin excepciones por tamaño:** si el pedido es de autenticación, la skill de auth se
lee siempre, aunque el cambio parezca de una línea. El `Invalid origin` del login salió de eso:
`createAuth` no declara `trustedOrigins` y la confianza quedó dependiendo de una variable de entorno
donde `localhost:3000` y `127.0.0.1:3000` son orígenes distintos (`BETTER_AUTH_TRUSTED_ORIGINS` los
acepta separados por coma). La skill de seguridad lo documenta en su sección de `trustedOrigins`.

## Skills de terceros

Las que instala `npx skills add` (hoy las seis de `better-auth`) quedan fijadas en
`skills-lock.json`. **No edites su `description` ni su contenido**: una reinstalación las pisa. Lo
que el repo necesite agregar sobre ellas va en este archivo o en `docs/operacion/`.
