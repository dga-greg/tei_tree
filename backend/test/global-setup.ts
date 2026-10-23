import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/**
 * Starts a single-node MongoDB replica set (transactions require a replica set).
 * Set MONGOMS_SYSTEM_BINARY to use a locally installed mongod instead of downloading one.
 */
export default async function setup(project: TestProject) {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
