# AUTH-P0 — Compatibilidad de Supabase Auth SSR, Next.js 16 y Netlify

Fecha de investigación: 2026-07-20  
Alcance: compatibilidad técnica, patrón SSR vigente, cookies, Proxy, variables de entorno y aprovisionamiento administrativo.  
Fuentes: exclusivamente documentación y repositorios oficiales de Next.js, Supabase y Netlify.

## Resumen ejecutivo

La combinación prevista para AUTH-P0 es compatible:

- la aplicación usa Next.js **16.2.10** con App Router;
- Supabase recomienda `@supabase/ssr` para sesiones almacenadas en cookies en aplicaciones SSR como Next.js;
- en Next.js 16 el mecanismo antes llamado Middleware se llama **Proxy** y usa `proxy.ts` con runtime Node.js;
- Netlify declara soporte completo para App Router, SSR, Route Handlers y Middleware/Proxy mediante su adaptador OpenNext para todas las versiones de Next.js desde 13.5, y afirma probar cada versión estable.

No existe una declaración oficial que nombre específicamente la pareja “Next.js 16.2.10 + `@supabase/ssr` 0.12.3”. La compatibilidad concreta se concluye por la convergencia de tres hechos oficiales: la guía vigente de Supabase usa las APIs actuales de Next.js 16 (`proxy.ts` y `await cookies()`), Next.js documenta esas APIs como vigentes en 16, y Netlify declara compatibilidad con cada versión estable. Esta conclusión es, por tanto, una **inferencia fuertemente sustentada**, no una matriz de compatibilidad publicada literalmente.

## Estado comprobado en el repositorio

### Hechos locales

- `apps/nexus-bi-app/package.json` declara `next: ^16.2.10`.
- `apps/nexus-bi-app/package-lock.json`, lockfile v3, resuelve exactamente `next` **16.2.10**.
- La aplicación usa App Router mediante `apps/nexus-bi-app/app/**`.
- Antes de AUTH-P0 no están declarados `@supabase/supabase-js` ni `@supabase/ssr` en `apps/nexus-bi-app/package.json`.
- No existe un `proxy.ts` ni un `middleware.ts` en la aplicación.
- `netlify.toml` usa:
  - base `apps/nexus-bi-app`;
  - comando `npm run build`;
  - publicación `.next`;
  - plugin `@netlify/plugin-nextjs` sin versión explícita.

No se leyó ningún `.env` ni se inspeccionaron valores secretos.

## Paquete correcto para la sesión SSR

### Hechos oficiales

Supabase distingue los paquetes según cómo llega la identidad:

- `@supabase/ssr`: sesiones almacenadas en cookies en frameworks SSR como Next.js;
- `@supabase/server`: autenticación stateless que llega mediante `Authorization: Bearer`;
- `@supabase/supabase-js`: cliente base o integraciones que gestionan la autenticación por cuenta propia.

Supabase aclara que `@supabase/ssr` no está deprecado y que reemplaza a los paquetes antiguos `@supabase/auth-helpers-*`. El paquete sigue marcado como beta, por lo que su API puede introducir cambios incompatibles antes de 1.0. Al 2026-07-20, npm publica `@supabase/ssr` 0.12.3 como versión `latest`.

Fuentes:

- [Supabase — Which package to use](https://supabase.com/docs/guides/auth/choosing-a-server-package)
- [Supabase — Server-Side Rendering](https://supabase.com/docs/guides/auth/server-side)
- [npm — @supabase/ssr](https://www.npmjs.com/package/@supabase/ssr)

### Conclusión para NEXUS

`@supabase/ssr` es el paquete correcto para el ciclo de vida de la sesión de usuario. Debe instalarse junto con `@supabase/supabase-js`, que es su cliente base y también es el cliente apropiado para un eventual script administrativo aislado.

No corresponde introducir `@supabase/server` para AUTH-P0: NEXUS usará una sesión de navegador compartida entre cliente y servidor mediante cookies, no un JWT Bearer stateless entregado a cada endpoint.

## Patrón vigente en Next.js App Router

### Clientes separados

La guía oficial de Supabase exige dos tipos de cliente:

1. un cliente de navegador creado con `createBrowserClient()`;
2. un cliente de servidor creado con `createServerClient()` para Server Components, Server Actions y Route Handlers.

El ejemplo oficial usa en ambos casos:

- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Fuentes:

- [Supabase — Creating a Supabase client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&package-manager=npm&queryGroups=framework&queryGroups=package-manager)
- [Supabase — Next.js Auth quickstart](https://supabase.com/docs/guides/auth/quickstarts/nextjs)

### Cookies asíncronas en Next.js 16

El ejemplo oficial actual de Supabase para Next.js crea el servidor por solicitud y hace:

```ts
const cookieStore = await cookies();
```

Luego entrega a `createServerClient()` un adaptador con `getAll()` y `setAll()`. El `setAll()` del cliente de Server Components tolera que la escritura falle, porque un Server Component no siempre puede modificar cookies; la renovación central se delega a Proxy.

Fuente primaria del ejemplo:

- [Supabase repository — `server.ts` del ejemplo Next.js](https://raw.githubusercontent.com/supabase/supabase/24ce0ba5f87698ad72c173c7a26fa6c5c105e8ca/examples/auth/nextjs/lib/supabase/server.ts)

Este uso de `await cookies()` coincide con las APIs asíncronas de request de Next.js 16 y es evidencia directa de que la guía actual ya no está basada en el patrón síncrono antiguo.

### Un cliente nuevo por solicitud

Supabase advierte que no se debe guardar un cliente autenticado en alcance de módulo o en estado global reutilizable. Un proceso serverless o persistente puede atender solicitudes de usuarios diferentes y provocar fuga o mezcla de sesiones. El cliente debe construirse dentro de cada solicitud o dentro de la función que obtiene el cookie store de esa solicitud.

Fuente:

- [Supabase — Advanced SSR guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)

## `proxy.ts` en Next.js 16

### Hechos oficiales de Next.js

Desde Next.js 16:

- `middleware.ts` fue renombrado a `proxy.ts`;
- la exportación recomendada se llama `proxy`;
- el archivo se ubica en la raíz de la aplicación, al mismo nivel que `app`, o dentro de `src` si la aplicación usa `src/app`;
- solo puede existir un Proxy por aplicación;
- su runtime es Node.js y no se puede configurar como Edge Runtime.

Next.js también aclara que Proxy sirve para chequeos optimistas, redirects y manipulación de requests/responses, pero no debe ser la única línea de autorización ni el lugar para consultas lentas.

Fuentes:

- [Next.js — Proxy](https://nextjs.org/docs/app/getting-started/proxy)
- [Next.js — Upgrade guide 16, `middleware` to `proxy`](https://nextjs.org/docs/app/guides/upgrading/version-16#middleware-to-proxy)
- [Next.js — Authentication](https://nextjs.org/docs/app/guides/authentication)

### Responsabilidades del Proxy de Supabase

La guía de Supabase atribuye al Proxy tres responsabilidades:

1. validar y renovar el token con `supabase.auth.getClaims()`;
2. copiar las cookies renovadas a `request.cookies`, para que los Server Components de la misma navegación reciban la sesión vigente;
3. copiar las cookies renovadas a `response.cookies`, para que el navegador reemplace los tokens anteriores.

El ejemplo oficial también exige devolver la misma respuesta en la que se escribieron las cookies. Si se construye otra `NextResponse`, deben copiarse request, cookies y headers; de lo contrario, navegador y servidor pueden quedar desincronizados y producir cierres de sesión aleatorios.

Fuentes:

- [Supabase — Creating a Supabase client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&package-manager=npm&queryGroups=framework&queryGroups=package-manager)
- [Supabase repository — `proxy.ts` del ejemplo Next.js](https://raw.githubusercontent.com/supabase/supabase/24ce0ba5f87698ad72c173c7a26fa6c5c105e8ca/examples/auth/nextjs/lib/supabase/proxy.ts)

### Matcher

El matcher oficial excluye como mínimo:

- `_next/static`;
- `_next/image`;
- `favicon.ico`;
- extensiones de imagen estática comunes.

Para NEXUS, el matcher puede cubrir todas las demás páginas y APIs. La distinción entre redirect de páginas y respuestas JSON `401`/`403` de APIs debe seguir en la capa de autorización o en el propio Proxy, sin convertir una llamada de API en HTML de login.

## Validación segura de sesión y autorización

### `getClaims()`, `getUser()` y `getSession()`

Supabase documenta esta separación:

- `getClaims()` verifica el JWT. Con claves asimétricas usa firma y JWKS cacheable; con claves simétricas recurre al servidor de Auth. Es el método recomendado para proteger páginas y datos.
- `getUser()` hace una llamada al servidor de Auth y obtiene el registro más reciente. Es necesario cuando importa saber si la sesión sigue vigente o fue revocada en el servidor.
- `getSession()` entrega tokens y expiración desde el almacenamiento de sesión, pero el objeto de usuario que contiene no debe usarse como prueba de identidad en servidor porque no se revalida.

Fuentes:

- [Supabase — Creating a Supabase client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&package-manager=npm&queryGroups=framework&queryGroups=package-manager)
- [Supabase — `getClaims()`](https://supabase.com/docs/reference/javascript/auth-getclaims)
- [Supabase — Advanced SSR guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)

### Consecuencia arquitectónica

Proxy debe mantener y prefiltrar la sesión, pero no reemplaza los controles cercanos a los datos. Next.js recomienda una capa de acceso/autorización central y chequeos en cada entrada sensible. Para NEXUS esto implica:

- páginas protegidas verificadas en servidor antes de entregar datos;
- todos los Route Handlers de datos verificados individualmente o mediante un wrapper común;
- `401 Unauthorized` si no hay sesión válida;
- `403 Forbidden` si la sesión es válida pero el rol es inexistente o insuficiente;
- ninguna autorización basada solo en layout, sidebar, Client Components o controles ocultos.

Next.js advierte que un layout puede no re-renderizarse en cada navegación por Partial Rendering, por lo que tampoco puede ser la única barrera.

Fuente:

- [Next.js — Authentication and authorization](https://nextjs.org/docs/app/guides/authentication)

## Cookies, expiración y caché

### Flujo y atributos

`@supabase/ssr` usa PKCE por defecto y guarda access token y refresh token en cookies compartidas entre navegador y servidor.

Supabase indica:

- `SameSite=Lax` es un buen valor por defecto para navegación normal;
- `Secure` debe usarse en HTTPS, pero debe manejarse con cuidado en `localhost`;
- `HttpOnly` no es necesario en su patrón SSR porque el cliente del navegador necesita acceso al refresh token para mantener la sesión;
- reducir artificialmente `Max-Age` o `Expires` no finaliza la sesión remota y puede degradar la experiencia.

Fuente:

- [Supabase — Advanced SSR guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)

### Caching y CDN

Una respuesta autenticada que contiene `Set-Cookie` no puede compartirse entre usuarios. Supabase advierte que cachear esa respuesta puede iniciar sesión a otro usuario con el token equivocado.

Requisitos oficiales relevantes:

- no usar ISR en rutas donde se maneja o renueva una sesión;
- en Next.js, marcar las páginas autenticadas como dinámicas cuando sea necesario;
- desde `@supabase/ssr` 0.10.0, `setAll()` recibe como segundo argumento los headers anti-cache (`Cache-Control`, `Expires`, `Pragma`);
- el adaptador debe copiar esos headers a la respuesta;
- si se usa una versión anterior o una implementación personalizada, establecer `Cache-Control: private, no-store` en rutas de autenticación.

Fuente:

- [Supabase — Advanced SSR guide, caching](https://supabase.com/docs/guides/auth/server-side/advanced-guide)

El ejemplo oficial vigente de Proxy ya copia todos los headers entregados a `setAll()`, por lo que AUTH-P0 debe conservar ese segundo argumento y no implementar la firma antigua que solo recibe cookies.

## Logout y revocación

`supabase.auth.signOut()` elimina la sesión activa del medio de almacenamiento. Supabase permite tres scopes:

- `global`, predeterminado: termina todas las sesiones del usuario;
- `local`: termina la sesión actual;
- `others`: termina todas salvo la actual.

Los refresh tokens se invalidan, pero un access token ya emitido puede seguir siendo criptográficamente válido hasta su expiración. Para NEXUS, el logout debe borrar correctamente las cookies de la respuesta y redirigir a `/login`; las páginas dinámicas y APIs deben volver a verificar la sesión en cada entrada. Si el requisito exige detectar una revocación remota inmediatamente, `getUser()` aporta una confirmación más reciente que la mera validación local con `getClaims()`.

Fuente:

- [Supabase — Signing out](https://supabase.com/docs/guides/auth/signout)
- [Supabase — Advanced SSR guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)

## Roles confiables

Supabase distingue dos almacenes de metadata:

- `raw_user_meta_data` / `user_metadata`: el usuario autenticado puede modificarlo; no debe contener autorización;
- `raw_app_meta_data` / `app_metadata`: el usuario no puede modificarlo; es apropiado para datos de autorización.

Los roles `gerencia` y `administracion` deben almacenarse en `app_metadata` o en una tabla server-side con permisos equivalentes, nunca en `user_metadata`, query parameters, localStorage o datos enviados por el cliente.

La metadata incluida en el JWT no cambia hasta que se renueva el token. Cualquier modificación administrativa de rol necesita refresh de sesión para reflejarse.

Fuentes:

- [Supabase — Row Level Security, `auth.jwt()` metadata](https://supabase.com/docs/guides/database/postgres/row-level-security#authjwt)
- [Supabase — Custom Claims and RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)

## Variables de entorno

### Hechos oficiales

Next.js solo expone variables al navegador cuando llevan el prefijo `NEXT_PUBLIC_`. Esas referencias se sustituyen e incorporan al bundle durante `next build`; quedan congeladas después del build. Las variables sin ese prefijo permanecen disponibles únicamente en el entorno Node.js.

Fuente:

- [Next.js — Environment variables](https://nextjs.org/docs/app/guides/environment-variables)

Netlify distingue scopes:

- **Builds**: disponibles durante el build;
- **Functions**: disponibles para Functions, Edge Functions y On-demand Builders;
- **Runtime**: en la terminología de Netlify se refiere a Forms y signed proxy redirects, no al runtime de las Functions.

Variables declaradas en `netlify.toml` no están disponibles para Functions. Para secretos deben usarse UI, CLI o API de Netlify. Los cambios de variables de Functions se aplican mediante un nuevo deploy.

Fuentes:

- [Netlify — Environment variables overview](https://docs.netlify.com/build/environment-variables/overview/)
- [Netlify — Environment variables and serverless functions](https://docs.netlify.com/build/functions/environment-variables/)

### Matriz para AUTH-P0

| Contexto | Variables | Motivo | Clasificación |
| --- | --- | --- | --- |
| Build de Netlify | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Next.js las incorpora al bundle del browser durante `next build` | Públicas, no secretos |
| Functions/Proxy de Netlify | Las mismas dos variables, con scope Functions o todos los scopes | Los clientes SSR y Proxy también las referencian; configurarlas en Functions evita depender del detalle de bundling del adaptador | Públicas, no secretos |
| Desarrollo local | Las mismas dos variables en un archivo local no versionado dentro de `apps/nexus-bi-app` | Next.js las carga desde la raíz de la aplicación | Públicas, pero configuración no versionada |
| Aprovisionamiento administrativo por script | `NEXT_PUBLIC_SUPABASE_URL` o la misma URL pasada al script, más `SUPABASE_SERVICE_ROLE_KEY` | `auth.admin.createUser()` requiere un cliente administrativo server-side | `SUPABASE_SERVICE_ROLE_KEY` es secreto de alto privilegio |

Configurar las dos variables públicas tanto para Builds como Functions es una **recomendación operativa conservadora**. Builds es obligatorio por el inline de `NEXT_PUBLIC_*`; Functions asegura disponibilidad para las piezas SSR generadas por el adaptador.

`SUPABASE_SERVICE_ROLE_KEY` no es necesaria para login, renovación, logout ni autorización normal. Si las dos cuentas se crean mediante Supabase Dashboard, no se necesita esa variable en el proyecto. Si se usa un script local de aprovisionamiento, debe permanecer solo en ese entorno administrativo temporal. No debe configurarse en Netlify para la aplicación productiva mientras NEXUS no tenga una función administrativa autorizada que la requiera.

## Aprovisionamiento de las identidades demo

### Hechos oficiales

`supabase.auth.admin.createUser()`:

- solo debe invocarse en servidor;
- requiere una clave `service_role`;
- admite email, password y confirmación administrativa del email;
- no debe exponer la clave al navegador.

Supabase recomienda un cliente `@supabase/supabase-js` separado para service role. No se debe inicializar un cliente `@supabase/ssr` con service role, porque la sesión de usuario leída desde cookies puede reemplazar el header `Authorization` y alterar el comportamiento privilegiado esperado.

Fuentes:

- [Supabase — `auth.admin.createUser()`](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase — Service role client and RLS troubleshooting](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z)
- [Supabase — Server-side client options](https://supabase.com/docs/reference/javascript/auth)

Para un cliente administrativo sin sesión persistente, la referencia oficial usa:

```ts
auth: {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
}
```

El rol puede establecerse en `app_metadata` durante la creación o actualizarse con `auth.admin.updateUserById()`.

Fuente:

- [Supabase — `auth.admin.updateUserById()`](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)

### Inferencia para el flujo de NEXUS

La interfaz puede aceptar `GERENCIA` o `ADMINISTRACION`, resolver la identidad técnica en una función server-only y llamar `signInWithPassword()` con email técnico y password. El cliente nunca necesita recibir el correo técnico ni aceptar emails arbitrarios.

Como el flujo es email/password directo, `/auth/callback` no es necesario. Un callback se vuelve necesario para flujos con redirección y canje PKCE, como OAuth, magic link o recuperación de password. Esta conclusión es una inferencia basada en los flujos documentados; no limita una ampliación futura.

## Compatibilidad específica con Netlify

Netlify declara soporte completo para:

- App Router;
- Server-Side Rendering;
- Server Components;
- Route Handlers;
- Middleware;
- Turbopack durante build;
- Cache Components.

El adaptador OpenNext crea Functions para SSR y Route Handlers, y una función de borde para Middleware/Proxy. Netlify mantiene el adaptador para Next.js 13.5 en adelante y recomienda no fijar su versión para recibir compatibilidad y correcciones nuevas.

Las limitaciones publicadas para Node.js Middleware son C++ addons y acceso a filesystem. El patrón de `@supabase/ssr` usa cookies, Web APIs y llamadas HTTP, por lo que no depende de esas capacidades.

Fuente:

- [Netlify — Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)

El `netlify.toml` actual declara el plugin, pero el package de la app no contiene una versión fijada. Según la guía de Netlify, fijar el adaptador requiere instalar una versión en `package.json` además de declararlo en configuración. Por ello no hay evidencia de un pin local. Conviene mantener el adaptador actualizado y validar el deploy preview, sin introducir una versión antigua fija.

## Riesgos y decisiones que debe respetar la implementación

1. **Proxy no basta:** cada Route Handler debe autorizar de nuevo y devolver 401/403, nunca una redirección HTML.
2. **No usar `getSession()` para autorizar:** usar `getClaims()` o `getUser()` según el nivel de frescura requerido.
3. **No usar metadata editable:** roles solo desde `app_metadata` o una fuente server-side equivalente.
4. **No reutilizar clientes autenticados entre solicitudes:** crear cliente SSR por request.
5. **No perder cookies ni headers al devolver Proxy:** retornar la response de Supabase o copiar íntegramente request, cookies y headers.
6. **No cachear respuestas autenticadas con `Set-Cookie`:** rutas protegidas dinámicas y headers anti-cache conservados.
7. **No exponer service role:** cliente administrativo separado, solo server-side y preferentemente fuera del runtime de producción.
8. **No confiar solo en layouts o UI:** los múltiples puntos de entrada de Next.js exigen controles cercanos a los datos.
9. **Tratar `@supabase/ssr` como beta:** fijar la versión resuelta en lockfile y ejecutar toda la validación antes de actualizar.
10. **Probar en Netlify:** aunque la compatibilidad esté oficialmente cubierta, el comportamiento de cookies, headers y redirects debe verificarse en un Deploy Preview antes de producción.

## Veredicto de compatibilidad

**COMPATIBLE CON CONDICIONES.**

AUTH-P0 puede implementarse sobre Next.js 16.2.10, App Router, `@supabase/ssr` y Netlify usando el patrón oficial vigente. Las condiciones son:

- `proxy.ts` de Next.js 16, no `middleware.ts` nuevo;
- cliente browser y cliente server separados;
- cookies sincronizadas en request y response;
- conservación de headers anti-cache de `setAll()`;
- validación segura en páginas y todos los Route Handlers;
- roles desde `app_metadata` o fuente server-only;
- `SUPABASE_SERVICE_ROLE_KEY` limitada a aprovisionamiento administrativo aislado;
- prueba real posterior con variables y cuentas de Supabase antes de declarar producción lista.
