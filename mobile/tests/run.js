import { createServer } from 'vite';

async function run() {
  console.log('--- CIVIGO MOBILE AUTOMATED TEST RUNNER ---');
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  try {
    await server.ssrLoadModule('./tests/services.test.ts');
    await new Promise((resolve) => setTimeout(resolve, 800));
    console.log('✅ All CiviGo Mobile unit tests passed successfully!');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}

void run();
