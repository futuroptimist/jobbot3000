import fs from 'node:fs/promises';
import path from 'node:path';

const JSON_RESUME_SCHEMA_URL =
  'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json';

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function createResumeSkeleton() {
  const timestamp = new Date().toISOString();
  return {
    $schema: JSON_RESUME_SCHEMA_URL,
    basics: {
      name: '',
      label: '',
      email: '',
      phone: '',
      website: '',
      summary: '',
      location: {
        city: '',
        region: '',
        country: '',
      },
    },
    work: [],
    volunteer: [],
    education: [],
    awards: [],
    publications: [],
    skills: [],
    languages: [],
    interests: [],
    references: [],
    projects: [],
    certificates: [],
    meta: {
      generatedAt: timestamp,
      generator: 'jobbot3000',
      version: '1.0.0',
    },
  };
}

export async function initProfile({ force = false } = {}) {
  const dataDir = resolveDataDir();
  const profileDir = path.join(dataDir, 'profile');
  const resumePath = path.join(profileDir, 'resume.json');

  await fs.mkdir(profileDir, { recursive: true });

  if (!force) {
    try {
      await fs.access(resumePath);
      return { created: false, path: resumePath };
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }

  const skeleton = createResumeSkeleton();
  await fs.writeFile(resumePath, `${JSON.stringify(skeleton, null, 2)}\n`, 'utf8');
  return { created: true, path: resumePath };
}

function sanitizeString(value) {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function sanitizeMultiline(value) {
  const str = sanitizeString(value);
  if (!str) return undefined;
  return str.replace(/\r?\n+/g, '\n').trim();
}

function formatLinkedInDate(input) {
  if (!input) return undefined;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    if (/^\d{4}$/.test(trimmed) || /^\d{4}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      const month = parsed.getUTCMonth() + 1;
      return Number.isFinite(month)
        ? `${year}-${String(month).padStart(2, '0')}`
        : `${year}`;
    }
    return undefined;
  }

  if (typeof input === 'object') {
    const year = Number(input.year);
    if (!Number.isFinite(year)) return undefined;
    const month = Number(input.month);
    if (Number.isFinite(month) && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
    return `${year}`;
  }

  return undefined;
}

function extractLinkedInLocation(data) {
  if (!data || typeof data !== 'object') return undefined;
  const rawLocation =
    sanitizeString(data.geoLocationName) ||
    sanitizeString(data.locationName) ||
    sanitizeString(data.location) ||
    sanitizeString(data.profileLocation?.displayName) ||
    sanitizeString(data.profileLocation?.defaultLocalizedNameWithoutCountryName);

  if (!rawLocation) return undefined;

  const parts = rawLocation
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  const location = {};
  if (parts.length === 1) {
    location.city = parts[0];
  } else if (parts.length === 2) {
    [location.city, location.region] = parts;
  } else {
    location.city = parts[0];
    location.region = parts[1];
    location.country = parts[parts.length - 1];
  }
  return location;
}

function mapLinkedInPositions(positions) {
  if (!Array.isArray(positions)) return [];
  const mapped = [];

  for (const position of positions) {
    if (!position || typeof position !== 'object') continue;

    const company =
      sanitizeString(position.companyName) ||
      sanitizeString(position.company?.name) ||
      sanitizeString(position.company?.companyName);
    const title = sanitizeString(position.title);
    if (!company && !title) continue;

    const entry = {};
    if (company) entry.name = company;
    if (title) entry.position = title;

    const summary = sanitizeMultiline(position.description || position.summary);
    if (summary) entry.summary = summary;

    const location = sanitizeString(position.locationName);
    if (location) entry.location = location;

    const startDate = formatLinkedInDate(position.timePeriod?.startDate || position.startDate);
    if (startDate) entry.startDate = startDate;
    const endDate = formatLinkedInDate(position.timePeriod?.endDate || position.endDate);
    if (endDate) entry.endDate = endDate;

    const url =
      sanitizeString(position.company?.companyPageUrl) ||
      sanitizeString(position.company?.canonicalUrl) ||
      sanitizeString(position.company?.websiteUrl) ||
      sanitizeString(position.company?.url);
    if (url) entry.url = url;

    mapped.push(entry);
  }

  return mapped;
}

function mapLinkedInEducation(entries) {
  if (!Array.isArray(entries)) return [];
  const mapped = [];

  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;

    const institution = sanitizeString(item.schoolName || item.school);
    const degree = sanitizeString(item.degreeName || item.degree);
    const field = sanitizeString(item.fieldOfStudy || item.field);
    if (!institution && !degree && !field) continue;

    const entry = {};
    if (institution) entry.institution = institution;
    if (degree) entry.studyType = degree;
    if (field) entry.area = field;

    const startDate = formatLinkedInDate(item.timePeriod?.startDate || item.startDate);
    if (startDate) entry.startDate = startDate;
    const endDate = formatLinkedInDate(item.timePeriod?.endDate || item.endDate);
    if (endDate) entry.endDate = endDate;

    mapped.push(entry);
  }

  return mapped;
}

function mapLinkedInSkills(skills) {
  if (!Array.isArray(skills)) return [];
  const mapped = [];

  for (const skill of skills) {
    let name;
    if (typeof skill === 'string') {
      name = sanitizeString(skill);
    } else if (skill && typeof skill === 'object') {
      name = sanitizeString(skill.name || skill.skillName || skill.localizedName);
    }
    if (!name) continue;
    mapped.push({ name });
  }

  return mapped;
}

function normalizeLinkedInProfile(data) {
  if (!data || typeof data !== 'object') {
    return { basics: {}, work: [], education: [], skills: [] };
  }

  const basics = {};
  const firstName = sanitizeString(data.firstName || data.first_name);
  const lastName = sanitizeString(data.lastName || data.last_name);
  const nameParts = [firstName, lastName].filter(Boolean);
  if (nameParts.length > 0) basics.name = nameParts.join(' ');

  const headline = sanitizeString(data.headline);
  if (headline) basics.label = headline;

  const summary = sanitizeMultiline(data.summary || data.summaryText || data.about);
  if (summary) basics.summary = summary;

  const contact = data.contactInfo || data['contact-info'];
  if (contact && typeof contact === 'object') {
    const email = sanitizeString(contact.emailAddress || contact.email);
    if (email) basics.email = email;

    const websites = Array.isArray(contact.websites) ? contact.websites : [];
    for (const site of websites) {
      const url = sanitizeString(site?.url || site);
      if (url) {
        basics.website = url;
        break;
      }
    }

    const phones = Array.isArray(contact.phoneNumbers) ? contact.phoneNumbers : [];
    for (const phone of phones) {
      const number = sanitizeString(phone?.number || phone);
      if (number) {
        basics.phone = number;
        break;
      }
    }
  }

  const location = extractLinkedInLocation(data);
  if (location) basics.location = location;

  return {
    basics,
    work: mapLinkedInPositions(data.positions || data.experiences || []),
    education: mapLinkedInEducation(data.educations || data.education || []),
    skills: mapLinkedInSkills(data.skills || data.skillItems || []),
  };
}

function ensureBasicsStructure(resume) {
  if (!resume.basics || typeof resume.basics !== 'object') {
    resume.basics = {
      name: '',
      label: '',
      email: '',
      phone: '',
      website: '',
      summary: '',
      location: { city: '', region: '', country: '' },
    };
  } else if (!resume.basics.location || typeof resume.basics.location !== 'object') {
    resume.basics.location = { city: '', region: '', country: '' };
  }
}

function applyField(target, key, value) {
  const clean = sanitizeString(value);
  if (!clean) return 0;
  const current = target[key];
  if (current && typeof current === 'string' && current.trim()) return 0;
  if (current === clean) return 0;
  target[key] = clean;
  return 1;
}

function mergeWorkEntries(resume, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  if (!Array.isArray(resume.work)) resume.work = [];

  const existingKeys = new Set(
    resume.work.map(item =>
      [
        sanitizeString(item.name)?.toLowerCase() || '',
        sanitizeString(item.position)?.toLowerCase() || '',
        sanitizeString(item.startDate) || '',
      ].join('|'),
    ),
  );

  let added = 0;
  for (const entry of entries) {
    const key = [
      sanitizeString(entry.name)?.toLowerCase() || '',
      sanitizeString(entry.position)?.toLowerCase() || '',
      sanitizeString(entry.startDate) || '',
    ].join('|');
    if (existingKeys.has(key)) continue;
    resume.work.push({ ...entry });
    existingKeys.add(key);
    added += 1;
  }
  return added;
}

function mergeEducationEntries(resume, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  if (!Array.isArray(resume.education)) resume.education = [];

  const existingKeys = new Set(
    resume.education.map(item =>
      [
        sanitizeString(item.institution)?.toLowerCase() || '',
        sanitizeString(item.studyType)?.toLowerCase() || '',
        sanitizeString(item.startDate) || '',
      ].join('|'),
    ),
  );

  let added = 0;
  for (const entry of entries) {
    const key = [
      sanitizeString(entry.institution)?.toLowerCase() || '',
      sanitizeString(entry.studyType)?.toLowerCase() || '',
      sanitizeString(entry.startDate) || '',
    ].join('|');
    if (existingKeys.has(key)) continue;
    resume.education.push({ ...entry });
    existingKeys.add(key);
    added += 1;
  }
  return added;
}

function mergeSkillEntries(resume, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  if (!Array.isArray(resume.skills)) resume.skills = [];

  const existing = new Set(
    resume.skills
      .map(skill => sanitizeString(skill?.name)?.toLowerCase())
      .filter(Boolean),
  );

  let added = 0;
  for (const entry of entries) {
    const name = sanitizeString(entry?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (existing.has(key)) continue;
    resume.skills.push({ name });
    existing.add(key);
    added += 1;
  }
  return added;
}

function mergeLinkedInIntoResume(resume, normalized) {
  const { basics, work, education, skills } = normalized;
  ensureBasicsStructure(resume);

  let basicsUpdated = 0;
  if (basics && typeof basics === 'object') {
    const target = resume.basics;
    basicsUpdated += applyField(target, 'name', basics.name);
    basicsUpdated += applyField(target, 'label', basics.label);
    basicsUpdated += applyField(target, 'email', basics.email);
    basicsUpdated += applyField(target, 'phone', basics.phone);
    basicsUpdated += applyField(target, 'website', basics.website);
    basicsUpdated += applyField(target, 'summary', basics.summary);

    if (basics.location && typeof basics.location === 'object') {
      const locTarget =
        target.location || (target.location = { city: '', region: '', country: '' });
      basicsUpdated += applyField(locTarget, 'city', basics.location.city);
      basicsUpdated += applyField(locTarget, 'region', basics.location.region);
      basicsUpdated += applyField(locTarget, 'country', basics.location.country);
    }
  }

  const workAdded = mergeWorkEntries(resume, work);
  const educationAdded = mergeEducationEntries(resume, education);
  const skillsAdded = mergeSkillEntries(resume, skills);

  return { basicsUpdated, workAdded, educationAdded, skillsAdded };
}

export async function importLinkedInProfile(filePath) {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('LinkedIn profile path is required');
  }

  const resolved = path.resolve(process.cwd(), filePath);
  let raw;
  try {
    raw = await fs.readFile(resolved, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(`LinkedIn profile not found: ${resolved}`);
    }
    throw err;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Invalid LinkedIn profile JSON');
  }

  const { path: resumePath } = await initProfile();
  let resumeRaw;
  try {
    resumeRaw = await fs.readFile(resumePath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      resumeRaw = JSON.stringify(createResumeSkeleton());
    } else {
      throw err;
    }
  }

  let resume;
  try {
    resume = JSON.parse(resumeRaw);
  } catch {
    throw new Error('Existing resume.json could not be parsed');
  }

  const normalized = normalizeLinkedInProfile(data);
  const result = mergeLinkedInIntoResume(resume, normalized);

  await fs.writeFile(resumePath, `${JSON.stringify(resume, null, 2)}\n`, 'utf8');
  return { path: resumePath, ...result };
}

export const PROFILE_SCHEMA_URL = JSON_RESUME_SCHEMA_URL;

export {
  sanitizeString,
  sanitizeMultiline,
  formatLinkedInDate,
  extractLinkedInLocation,
  mapLinkedInPositions,
  mapLinkedInEducation,
  mapLinkedInSkills,
  normalizeLinkedInProfile,
  mergeLinkedInIntoResume,
};
