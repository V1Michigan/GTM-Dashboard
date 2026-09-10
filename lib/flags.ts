/**
 * AUTH_BYPASS: when `DEV_BYPASS_AUTH=true`, every request is treated as a fixed
 * admin session and server reads run through the service-role key, which
 * bypasses RLS.
 *
 * This is honoured in ALL environments, production included. While it is on,
 * anyone who can reach the site has full admin read/write over every person,
 * event and form submission without signing in. Set it only on a deployment
 * that is otherwise protected (or not public), and unset it to restore normal
 * auth — nothing else needs changing.
 */
export const AUTH_BYPASS = process.env.DEV_BYPASS_AUTH === 'true';
