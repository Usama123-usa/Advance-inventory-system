const ApiError = require('../utils/ApiError');

const notFound = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

// Postgres unique/foreign-key violation codes mapped to friendly messages.
const PG_ERROR_MESSAGES = {
  23505: 'A record with these details already exists.',
  23503: 'This action references a record that no longer exists.',
  23502: 'A required field is missing.',
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details || undefined;

  if (err.code && PG_ERROR_MESSAGES[err.code]) {
    statusCode = 400;
    message = PG_ERROR_MESSAGES[err.code];
  }

  if (!(err instanceof ApiError) && statusCode === 500) {
    console.error('[error]', err);
    if (process.env.NODE_ENV === 'production') {
      message = 'Internal server error';
    }
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { details } : {}),
  });
};

module.exports = { notFound, errorHandler };
