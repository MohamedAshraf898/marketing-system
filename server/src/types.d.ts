import type { Role } from '../../shared/src/enums';
import type { Scope } from './authz/scope';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  clientId: string | null;
  avatar: string | null;
  locale: string;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      scope?: Scope;
    }
  }
}

export {};
