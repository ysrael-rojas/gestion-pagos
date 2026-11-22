import { Module } from "@nestjs/common";
import { DATABASE, type Database } from "../db/db.provider";
import { AuthController } from "./auth.controller";
import { createAuth, type Auth } from "./auth";
import { AUTH } from "./auth.token";
import { SessionGuard } from "./session.guard";

@Module({
	controllers: [AuthController],
	providers: [
		{
			provide: AUTH,
			useFactory: (db: Database): Auth => createAuth(db),
			inject: [DATABASE],
		},
		SessionGuard,
	],
	exports: [AUTH, SessionGuard],
})
export class AuthModule {}
