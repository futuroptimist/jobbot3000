import fs from 'node:fs/promises';
import path from 'node:path';
import { runResumePipeline } from './pipeline/resume-pipeline.js';

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

function normalizeSnapshotNote(note) {
  if (note === undefined) return undefined;
  const value = typeof note === 'string' ? note : String(note ?? '');
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('snapshot note cannot be empty');
  }
  return trimmed;
}

function slugifyNote(note) {
  return note
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function ensureUniqueSnapshotBasename(dir, base) {
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const candidate = `${base}${suffix}.json`;
    const fullPath = path.join(dir, candidate);
    try {
      await fs.access(fullPath);
    } catch (err) {
      if (err?.code === 'ENOENT') return candidate;
      throw err;
    }
    attempt += 1;
  }
}

export async function snapshotProfile({ note } = {}) {
  const dataDir = resolveDataDir();
  const profileDir = path.join(dataDir, 'profile');
  const resumePath = path.join(profileDir, 'resume.json');

  let raw;
  try {
    raw = await fs.readFile(resumePath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      const hint = 'Run `jobbot profile init` first.';
      throw new Error(`Profile resume not found at ${resumePath}. ${hint}`);
    }
    throw new Error(
      `Failed to read profile resume at ${resumePath}: ${err.message || err}`,
    );
  }

  let resume;
  try {
    resume = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Profile resume at ${resumePath} could not be parsed as JSON: ${err.message || err}`,
    );
  }

  const trimmedNote = normalizeSnapshotNote(note);

  const createdAt = new Date().toISOString();
  const snapshotsDir = path.join(profileDir, 'snapshots');
  await fs.mkdir(snapshotsDir, { recursive: true });

  const timestampSlug = createdAt.replace(/:/g, '-');
  const noteSlug = trimmedNote ? slugifyNote(trimmedNote) : '';
  const base = noteSlug ? `${timestampSlug}-${noteSlug}` : timestampSlug;
  const fileName = await ensureUniqueSnapshotBasename(snapshotsDir, base);
  const targetPath = path.join(snapshotsDir, fileName);

  const relativeSource = path.relative(profileDir, resumePath) || 'resume.json';
  const snapshot = {
    created_at: createdAt,
    source_path: relativeSource.replace(/\\/g, '/'),
    resume,
  };
  if (trimmedNote) {
    snapshot.note = trimmedNote;
  }

  await fs.writeFile(targetPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  return { path: targetPath, snapshot };
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
    const skill = { name };
    if (entry.level) skill.level = entry.level;
    if (Array.isArray(entry.keywords) && entry.keywords.length) {
      skill.keywords = [...entry.keywords];
    }
    resume.skills.push(skill);
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

function stripUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null),
  );
}

function normalizeJsonResumeBasics(basics) {
  if (!basics || typeof basics !== 'object') return undefined;
  const location = basics.location && typeof basics.location === 'object'
    ? stripUndefined({
        city: sanitizeString(basics.location.city),
        region: sanitizeString(basics.location.region),
        country: sanitizeString(basics.location.country),
      })
    : undefined;

  const normalized = stripUndefined({
    name: sanitizeString(basics.name),
    label: sanitizeString(basics.label),
    email: sanitizeString(basics.email),
    phone: sanitizeString(basics.phone),
    website: sanitizeString(basics.website || basics.url),
    summary: sanitizeMultiline(basics.summary),
  });

  if (location && Object.keys(location).length) {
    normalized.location = location;
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeJsonResumeArray(entries, mapper) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const mapped = mapper(entry);
      return mapped && Object.keys(mapped).length ? mapped : null;
    })
    .filter(Boolean);
}

function normalizeJsonWork(entries) {
  return normalizeJsonResumeArray(entries, entry => {
    const highlights = Array.isArray(entry.highlights)
      ? entry.highlights.map(sanitizeMultiline).filter(Boolean)
      : undefined;

    const normalized = stripUndefined({
      name: sanitizeString(entry.name || entry.company),
      position: sanitizeString(entry.position || entry.title),
      url: sanitizeString(entry.url),
      location: sanitizeString(entry.location),
      startDate: sanitizeString(entry.startDate),
      endDate: sanitizeString(entry.endDate),
      summary: sanitizeMultiline(entry.summary),
    });

    if (highlights && highlights.length) normalized.highlights = highlights;
    return normalized;
  });
}

function normalizeJsonEducation(entries) {
  return normalizeJsonResumeArray(entries, entry =>
    stripUndefined({
      institution: sanitizeString(entry.institution),
      studyType: sanitizeString(entry.studyType),
      area: sanitizeString(entry.area),
      startDate: sanitizeString(entry.startDate),
      endDate: sanitizeString(entry.endDate),
      score: sanitizeString(entry.score),
    }),
  );
}

function normalizeJsonSkills(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;

      const keywords = Array.isArray(entry.keywords)
        ? entry.keywords
            .flatMap(value => {
              if (typeof value !== 'string') return [];
              const trimmed = value.trim();
              return trimmed ? [trimmed] : [];
            })
        : [];

      const normalized = stripUndefined({
        name: sanitizeString(entry.name),
        level: sanitizeString(entry.level),
      });

      if (keywords.length) normalized.keywords = keywords;
      return Object.keys(normalized).length ? normalized : null;
    })
    .filter(Boolean);
}

function normalizeJsonResume(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid JSON Resume: expected an object');
  }

  const basics = normalizeJsonResumeBasics(data.basics);
  const work = normalizeJsonWork(data.work);
  const education = normalizeJsonEducation(data.education);
  const skills = normalizeJsonSkills(data.skills);

  return { basics, work, education, skills };
}

function mergeJsonResume(resume, normalized) {
  const { basics, work, education, skills } = normalized;
  ensureBasicsStructure(resume);

  let basicsUpdated = 0;
  if (basics) {
    basicsUpdated += applyField(resume.basics, 'name', basics.name);
    basicsUpdated += applyField(resume.basics, 'label', basics.label);
    basicsUpdated += applyField(resume.basics, 'email', basics.email);
    basicsUpdated += applyField(resume.basics, 'phone', basics.phone);
    basicsUpdated += applyField(resume.basics, 'website', basics.website);
    basicsUpdated += applyField(resume.basics, 'summary', basics.summary);

    if (basics.location && typeof basics.location === 'object') {
      const target =
        resume.basics.location || (resume.basics.location = { city: '', region: '', country: '' });
      basicsUpdated += applyField(target, 'city', basics.location.city);
      basicsUpdated += applyField(target, 'region', basics.location.region);
      basicsUpdated += applyField(target, 'country', basics.location.country);
    }
  }

  const workAdded = mergeWorkEntries(resume, work);
  const educationAdded = mergeEducationEntries(resume, education);
  const skillsAdded = mergeSkillEntries(resume, skills);

  if (!resume.$schema) {
    resume.$schema = JSON_RESUME_SCHEMA_URL;
  }

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

export async function importJsonResume(filePath) {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('JSON Resume path is required');
  }

  const resolved = path.resolve(process.cwd(), filePath);
  let raw;
  try {
    raw = await fs.readFile(resolved, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(`JSON Resume not found: ${resolved}`);
    }
    throw err;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON Resume JSON');
  }

  const normalized = normalizeJsonResume(data);
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

  const result = mergeJsonResume(resume, normalized);
  await fs.writeFile(resumePath, `${JSON.stringify(resume, null, 2)}\n`, 'utf8');
  return { path: resumePath, ...result };
}

export async function exportProfileResume({ outPath } = {}) {
  const dataDir = resolveDataDir();
  const profileDir = path.join(dataDir, 'profile');
  const resumePath = path.join(profileDir, 'resume.json');

  let raw;
  try {
    raw = await fs.readFile(resumePath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      const hint = 'Run `jobbot profile init` first.';
      throw new Error(`Profile resume not found at ${resumePath}. ${hint}`);
    }
    throw new Error(
      `Failed to read profile resume at ${resumePath}: ${err.message || err}`,
    );
  }

  let resume;
  try {
    resume = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Profile resume at ${resumePath} could not be parsed as JSON: ${err.message || err}`,
    );
  }

  if (outPath) {
    const resolved = path.resolve(process.cwd(), outPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, `${JSON.stringify(resume, null, 2)}\n`, 'utf8');
    return { path: resumePath, exportedPath: resolved, resume };
  }

  return { path: resumePath, exportedPath: undefined, resume };
}

export async function inspectResumeFile(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('resume path is required');
  }

  const resolvedPath = path.resolve(process.cwd(), filePath.trim());
  const pipeline = await runResumePipeline(resolvedPath, options);

  const result = {
    path: resolvedPath,
    text: pipeline.text,
    metadata: pipeline.metadata ?? {},
  };

  if (options.withMetrics) {
    result.analysis = pipeline.analysis ?? null;
    result.enrichment = pipeline.enrichment ?? null;
    result.score = pipeline.score ?? null;
  }

  return result;
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
