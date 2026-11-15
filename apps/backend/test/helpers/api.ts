import request from 'supertest';
import { createApp } from '../../src/app.js';

const app = createApp();

// A Supertest client for the real app, without opening a port.
export function api() {
  return request(app);
}
