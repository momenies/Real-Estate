import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'node:path';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Everything that turns a bare Nest app into *this* app.
 *
 * Extracted from the bootstrap so the tests configure the application exactly
 * as production does - otherwise a test could pass against a wiring that main.ts
 * never actually applies.
 */
export function configureApp(app: NestExpressApplication): void {
  app.use(
    helmet({
      // The Haraj helper page and the dashboard are server-served HTML with
      // their own inline styles.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // The network dashboard - the platform owner's only screen - ships from this
  // same service, so there is nothing extra to deploy. It is plain static HTML;
  // every byte of data behind it still goes through the authenticated API.
  app.useStaticAssets(join(__dirname, '..', 'public', 'dashboard'), {
    prefix: '/dashboard',
  });

  app.setGlobalPrefix('api', {
    exclude: [
      // The bare root must stay outside /api - it is what a browser opens
      // first, and it redirects to the dashboard.
      { path: '/', method: RequestMethod.GET },
      'health',
      'webhooks/whatsapp',
      'share/haraj/:token',
    ],
  });
}
