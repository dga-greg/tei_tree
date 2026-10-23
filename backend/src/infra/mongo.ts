import mongoose from 'mongoose';
import type { Logger } from '../core/logger.js';

export async function connectMongo(uri: string, logger: Logger): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info('MongoDB connected');
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** Builds every model's indexes. Run at start-up (idempotent) so new indexes appear on deploy. */
export async function syncIndexes(logger: Logger): Promise<void> {
  for (const model of Object.values(mongoose.models)) {
    await model.createIndexes();
  }
  logger.info({ models: Object.keys(mongoose.models).length }, 'MongoDB indexes ensured');
}
