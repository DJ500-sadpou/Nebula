import type { NextConfig } from 'next';

/**
 * `allowedDevOrigins` solo afecta al servidor de desarrollo: Next rechaza
 * peticiones cuyo Host no conoce. El hostname del preview cambia al restaurar
 * la máquina, así que se inyecta por entorno (`NEXT_DEV_ORIGIN`) en vez de
 * escribirlo en el repositorio. En producción no se usa.
 */
const devOrigin = process.env.NEXT_DEV_ORIGIN?.replace(/^https?:\/\//, '').replace(/\/$/, '');

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigin ? [devOrigin] : [],
};

export default nextConfig;
