import { defineConfig } from '@trigger.dev/sdk/v3';

/** Project ref comes from the Trigger.dev dashboard; the placeholder keeps typecheck honest without one. */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? 'proj_backlogconflictagents',
  runtime: 'node',
  logLevel: 'log',
  maxDuration: 300,
  dirs: ['./src/trigger'],
});
