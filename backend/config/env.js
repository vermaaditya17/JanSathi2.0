import dotenv from 'dotenv';

const result = dotenv.config({ override: true });

if (result.error) {
  throw new Error(`Unable to load backend environment: ${result.error.message}`);
}

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in backend/.env');
}

export default process.env;
