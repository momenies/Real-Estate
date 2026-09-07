import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

const hasDatabase = !!process.env.DATABASE_URL;
const describeWithDb = hasDatabase ? describe : describe.skip;

/**
 * The dashboard is static HTML served by the API process itself, so the thing
 * that can silently break is the wiring - a moved directory, a dropped COPY in
 * the image, a changed prefix. This boots the real application through the same
 * `configureApp` that production uses and asks for the files over HTTP.
 */
describeWithDb('network dashboard', () => {
  let app: INestApplication;
  let origin: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    await app.listen(0);
    origin = await app.getUrl();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('serves the dashboard page', async () => {
    const response = await fetch(`${origin}/dashboard/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('./app.js');
  });

  it('serves its stylesheet and script', async () => {
    for (const [asset, type] of [
      ['app.css', 'text/css'],
      ['app.js', 'javascript'],
    ]) {
      const response = await fetch(`${origin}/dashboard/${asset}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(type);
    }
  });

  it('keeps the dashboard outside the /api prefix', async () => {
    const response = await fetch(`${origin}/api/dashboard/`);
    expect(response.status).toBe(404);
  });

  it('refuses the network data to anyone without a token', async () => {
    const response = await fetch(`${origin}/api/admin/overview`);
    expect(response.status).toBe(401);
  });

  it('refuses the network data to an office user', async () => {
    // The page itself is public HTML; what it shows is not. An office owner
    // holds a valid token and must still be turned away from cross-office data.
    const token = await app.get(JwtService).signAsync({
      sub: '00000000-0000-0000-0000-000000000001',
      role: 'OFFICE_OWNER',
      officeId: '00000000-0000-0000-0000-000000000002',
      name: 'office owner',
    });

    const response = await fetch(`${origin}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(403);
  });
});
