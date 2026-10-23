import argon2 from 'argon2';

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/** Argon2id password hashing. */
export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly params: Argon2Params) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...this.params });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, this.params);
  }

  /**
   * Performs a verification of comparable cost when no account exists, so response time does not
   * reveal whether an e-mail address is registered.
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-equalisation');
    await this.verify(await this.dummyHash, password);
  }
}
