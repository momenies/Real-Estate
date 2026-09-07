import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwtSecret'),
        signOptions: {
          // The `ms` string template type is stricter than our config string.
          expiresIn: (config.get<string>('jwtExpiresIn') ?? '12h') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule implements OnModuleInit {
  constructor(private readonly auth: AuthService) {}

  async onModuleInit(): Promise<void> {
    await this.auth.ensureSuperAdmin();
  }
}
