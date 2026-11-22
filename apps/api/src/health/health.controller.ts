import { Controller, Get } from "@nestjs/common";

export interface HealthResponse {
	status: "ok";
	service: "@gestion/api";
	timestamp: string;
}

/**
 * Liveness. No toca la base a proposito: responde mientras el proceso este arriba, que es lo
 * que necesita el contenedor. La conectividad con PostgreSQL se verifica con una query real
 * (hoy: `GET /payments`), no aca.
 */
@Controller()
export class HealthController {
	@Get("health")
	check(): HealthResponse {
		return { status: "ok", service: "@gestion/api", timestamp: new Date().toISOString() };
	}
}
