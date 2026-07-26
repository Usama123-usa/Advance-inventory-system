require('dotenv').config();
const app = require('../server/src/app');

// Vercel treats a default-exported Express app as a request handler directly.
module.exports = app;
