import type { NextConfig } from "next";

// `@gestion/shared` se publica como TypeScript fuente (main/types -> src/index.ts), asi que
// Next tiene que compilarlo como parte de la app. Sus imports internos son **relativos**: no
// depende de los `paths` de este paquete ni de ningun alias del consumidor. `@/*` queda
// reservado para los archivos de `apps/web`.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@gestion/shared"],
  // Marca la app como gestionada por el protocolo de actualizaciones de seguridad de Next
  // (`next upgrade --agent=security`). Se subio de 16.4.3 a 16.4.6 por un aviso publicado:
  // sin esta marca el primer build en frio de cada sesion falla con SecurityFatalError.
  experimental: {
    agentUpgrade: "security",
  },
};

export default nextConfig;
