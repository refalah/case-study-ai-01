const Joi = require('joi');

const evaluateSchema = Joi.object({
  job_title: Joi.string().min(3).max(100).required(),
  cv_id: Joi.string().uuid().required(),
  project_report_id: Joi.string().uuid().required()
});

const resultSchema = Joi.object({
  id: Joi.string().uuid().required()
});

module.exports = {
  evaluateSchema,
  resultSchema
};