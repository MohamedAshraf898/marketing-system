import type { Client } from '@prisma/client';

export const parseTags = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * Client record as seen by ADMIN / TEAM: every field (the logo storage key is replaced by `hasLogo`).
 */
export function staffClientDto<T extends Client>(c: T) {
  const { logo, tags, ...rest } = c;
  return { ...rest, tags: parseTags(tags), hasLogo: !!logo };
}

/**
 * Client record as seen by a CLIENT user: an explicit WHITELIST (never a blacklist), so a field added to the model
 * later is private by default. Retainer, contract dates, lead source, account manager, tags, onboarding state,
 * client type and internal notes never leave the server for a client user.
 */
export function portalClientDto<T extends Client>(c: T) {
  return {
    id: c.id,
    name: c.name,
    companyName: c.companyName,
    email: c.email,
    phone: c.phone,
    status: c.status,
    industry: c.industry,
    website: c.website,
    address: c.address,
    country: c.country,
    city: c.city,
    notes: c.notes,
    hasLogo: !!c.logo,
    createdAt: c.createdAt,
  };
}

export const clientDtoFor = <T extends Client>(role: 'ADMIN' | 'TEAM' | 'CLIENT', c: T) =>
  role === 'CLIENT' ? portalClientDto(c) : staffClientDto(c);
