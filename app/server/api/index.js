// Vercel serverless entry — the Express app is a valid (req, res) handler.
// process.env.VERCEL is set by Vercel, so src/index.js skips app.listen() and just exports the app.
export { default } from '../src/index.js';
