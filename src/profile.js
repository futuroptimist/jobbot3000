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

/**
 * Initialise the profile workspace by creating a JSON Resume skeleton.
 * When the resume already exists and `force` is false, the file is left untouched.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ created: boolean, path: string }>}
 *   Result describing whether the file was created.
 */
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

export const PROFILE_SCHEMA_URL = JSON_RESUME_SCHEMA_URL;
